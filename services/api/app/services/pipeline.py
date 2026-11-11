"""The utterance pipeline: canonical utterance → STT (if audio) → one
translation per distinct target language → per-language events.

One failing language never blocks the others; the original text is always
preserved and delivered.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.logging import log_event
from app.models import Room, RoomGlossary, RoomParticipant, Translation, Utterance
from app.providers.base import (
    AudioInput,
    GlossaryEntry,
    ProviderError,
    TranslationContext,
    TranslationProvider,
    TranslationResult,
)
from app.providers.registry import providers
from app.realtime.hub import emit
from app.schemas.api import TranslationOut, UtteranceOut
from app.services import usage
from app.services.caches import TTLCache, cache_key

log = logging.getLogger("bridge.pipeline")

LOW_CONFIDENCE = 0.6

_settings = get_settings()
translation_cache: TTLCache[TranslationResult] = TTLCache(
    _settings.translation_cache_max_entries, _settings.translation_cache_ttl_seconds
)
_room_locks: dict[str, asyncio.Lock] = {}
_tasks: set[asyncio.Task] = set()


def _lock(room_id: str) -> asyncio.Lock:
    return _room_locks.setdefault(room_id, asyncio.Lock())


def utterance_out(u: Utterance, speaker_name: str, translations: list[Translation] | None = None) -> UtteranceOut:
    out = UtteranceOut.model_validate(
        {
            **{c: getattr(u, c) for c in UtteranceOut.model_fields if c != "translations" and hasattr(u, c)},
            "speaker_name": speaker_name,
            "translations": [],
        }
    )
    out.translations = [TranslationOut.model_validate(t) for t in (translations or [])]
    return out


@dataclass
class Submission:
    room: Room
    participant: RoomParticipant
    idempotency_key: str
    input_mode: str  # voice_server | voice_browser | text
    text: str | None = None
    audio: AudioInput | None = None
    source_language: str | None = None
    confidence: float | None = None
    audio_duration_ms: int | None = None


async def create_utterance(db: AsyncSession, sub: Submission) -> tuple[Utterance, bool]:
    """Persists the canonical utterance. Returns (utterance, created). Duplicate
    submissions with the same idempotency key return the original utterance."""
    existing = (
        await db.execute(
            select(Utterance).where(
                Utterance.participant_id == sub.participant.id, Utterance.idempotency_key == sub.idempotency_key
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing, False

    seconds = (sub.audio_duration_ms or 0) / 1000 if sub.input_mode == "voice_server" else 0
    await usage.check_before_utterance(db, sub.room.id, sub.participant.id, seconds, len(sub.text or ""))

    async with _lock(sub.room.id):
        room = await db.get(Room, sub.room.id, populate_existing=True)
        assert room is not None
        seq = room.next_sequence
        room.next_sequence = seq + 1
        u = Utterance(
            room_id=room.id,
            participant_id=sub.participant.id,
            idempotency_key=sub.idempotency_key,
            input_mode=sub.input_mode,
            source_language=sub.source_language or sub.participant.spoken_language or sub.participant.preferred_language,
            original_text=sub.text,
            recognition_confidence=sub.confidence,
            stt_provider="browser" if sub.input_mode == "voice_browser" else None,
            audio_duration_ms=sub.audio_duration_ms,
            processing_status="processing",
            sequence_number=seq,
        )
        db.add(u)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            dup = (
                await db.execute(
                    select(Utterance).where(
                        Utterance.participant_id == sub.participant.id,
                        Utterance.idempotency_key == sub.idempotency_key,
                    )
                )
            ).scalar_one()
            return dup, False
    return u, True


def start_processing(session_factory: async_sessionmaker, utterance_id: str, audio: AudioInput | None) -> None:
    task = asyncio.create_task(process_utterance(session_factory, utterance_id, audio))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def drain_tasks() -> None:
    """Test/shutdown helper: wait for in-flight pipeline tasks."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def process_utterance(session_factory: async_sessionmaker, utterance_id: str, audio: AudioInput | None) -> None:
    s = get_settings()
    async with session_factory() as db:
        u = await db.get(Utterance, utterance_id)
        if u is None:
            return
        speaker = await db.get(RoomParticipant, u.participant_id)
        room = await db.get(Room, u.room_id)
        if speaker is None or room is None:
            return
        started = time.monotonic()
        base = {"room_id": u.room_id, "participant_id": u.participant_id, "utterance_id": u.id,
                "sequence_number": u.sequence_number}
        await emit("utterance.processing", **base, payload={
            "speaker_name": speaker.display_name, "input_mode": u.input_mode,
            "created_at": u.created_at.isoformat()})

        # 1. Speech recognition (server-side) ------------------------------
        if audio is not None:
            p = providers()
            if p.stt is None:
                await _fail(db, u, base, "stt_not_configured", "Server speech recognition is not configured.")
                return
            try:
                result = await asyncio.wait_for(
                    p.stt.transcribe(audio, u.source_language if not p.stt.detects_language else None),
                    timeout=s.provider_timeout_seconds + 5,
                )
            except (ProviderError, TimeoutError) as exc:
                code = exc.code if isinstance(exc, ProviderError) else "provider_timeout"
                log_event(log, "stt.failed", room_id=u.room_id, utterance_id=u.id, provider=p.stt.name, code=code)
                await _fail(db, u, base, code, "Speech could not be recognised. Please try again.")
                return
            await usage.record(db, room_id=u.room_id, participant_id=u.participant_id, kind="stt_seconds",
                               provider=p.stt.name, quantity=(u.audio_duration_ms or 0) / 1000,
                               unit_cost=p.stt.cost_per_unit)
            u.stt_provider = p.stt.name
            if not result.text.strip():
                await db.commit()
                await _fail(db, u, base, "no_speech", "No speech was detected. Try speaking closer to the microphone.")
                return
            u.original_text = result.text.strip()[: s.max_text_chars * 2]
            # Only trust a detected language if BRIDGE knows it and the room allows it.
            if result.language and result.language in room.allowed_languages:
                u.source_language = result.language
            u.recognition_confidence = result.confidence

        u.processing_status = "transcribed"
        await db.commit()
        uncertain = u.recognition_confidence is not None and u.recognition_confidence < LOW_CONFIDENCE
        await emit("utterance.transcribed", **base, payload={
            **utterance_out(u, speaker.display_name).model_dump(mode="json"),
            "recognition_uncertain": uncertain,
            "stt_latency_ms": int((time.monotonic() - started) * 1000),
        })

        # 2. Translation: once per distinct target language ---------------
        targets = await _target_languages(db, room.id, u.source_language)
        if not targets:
            u.processing_status = "complete"
            await db.commit()
            return
        glossary = await _glossary(db, room.id)
        context = await _context(db, u, room)
        results = await asyncio.gather(
            *(_translate_one(u, lang, glossary, room.glossary_version, context) for lang in targets)
        )
        any_ok = False
        for lang, (result, error_code, latency) in zip(targets, results, strict=True):
            if result is not None:
                any_ok = True
                status_ = "uncertain" if (result.uncertain or uncertain) else "translated"
                note = result.note or ("Speech recognition confidence was low." if uncertain else None)
                t = Translation(utterance_id=u.id, target_language=lang, translated_text=result.text,
                                provider=result.provider, quality_status=status_, quality_note=note,
                                glossary_terms=result.glossary_terms_applied, latency_ms=latency)
            else:
                t = Translation(utterance_id=u.id, target_language=lang, translated_text=None,
                                provider=providers().translation.name, quality_status="failed",
                                quality_note=error_code, latency_ms=latency)
            db.add(t)
            await db.flush()
            await emit("translation.ready" if result else "translation.failed", **base,
                       payload=TranslationOut.model_validate(t).model_dump(mode="json"))
        await usage.record(db, room_id=u.room_id, participant_id=u.participant_id, kind="translate_chars",
                           provider=providers().translation.name,
                           quantity=len(u.original_text or "") * len(targets),
                           unit_cost=providers().translation.cost_per_unit)
        u.processing_status = "complete" if any_ok and all(r[0] for r in results) else ("partial" if any_ok else "translation_failed")
        await db.commit()
        log_event(log, "utterance.done", room_id=u.room_id, utterance_id=u.id, targets=len(targets),
                  status=u.processing_status, total_ms=int((time.monotonic() - started) * 1000))


async def _fail(db: AsyncSession, u: Utterance, base: dict, code: str, message: str) -> None:
    u.processing_status = "failed"
    u.error_code = code
    await db.commit()
    await emit("utterance.failed", **base, payload={"error_code": code, "message": message})


async def _target_languages(db: AsyncSession, room_id: str, source: str | None) -> list[str]:
    rows = (
        await db.execute(
            select(RoomParticipant.preferred_language)
            .where(RoomParticipant.room_id == room_id, RoomParticipant.left_at.is_(None))
            .distinct()
        )
    ).scalars().all()
    return sorted({lang for lang in rows if lang != source})


async def _glossary(db: AsyncSession, room_id: str) -> list[GlossaryEntry]:
    rows = (
        await db.execute(select(RoomGlossary).where(RoomGlossary.room_id == room_id, RoomGlossary.status == "approved"))
    ).scalars().all()
    return [GlossaryEntry(r.source_term, r.preferred_translation, r.source_language, r.target_language) for r in rows]


async def _context(db: AsyncSession, u: Utterance, room: Room) -> TranslationContext:
    n = get_settings().translation_context_turns
    if n <= 0 or not providers().translation.uses_context:
        return TranslationContext(topic=room.topic)
    prev = (
        await db.execute(
            select(Utterance.original_text)
            .where(Utterance.room_id == u.room_id, Utterance.sequence_number < u.sequence_number,
                   Utterance.original_text.is_not(None))
            .order_by(Utterance.sequence_number.desc())
            .limit(n)
        )
    ).scalars().all()
    return TranslationContext(recent_turns=list(reversed(prev)), topic=room.topic)


async def translate_text(
    text: str,
    source: str,
    target: str,
    glossary: list[GlossaryEntry],
    glossary_version: int,
    context: TranslationContext,
) -> TranslationResult:
    """Cached translation with optional fallback provider."""
    p = providers()
    ctx_version = cache_key(*context.recent_turns, context.topic) if p.translation.uses_context else "-"
    key = cache_key(p.translation.name, text, source, target, glossary_version, ctx_version)
    cached = translation_cache.get(key)
    if cached is not None:
        return cached
    chain: list[TranslationProvider] = [p.translation] + ([p.translation_fallback] if p.translation_fallback else [])
    last: ProviderError | None = None
    for provider in chain:
        if not (provider.supports(source) and provider.supports(target)):
            last = ProviderError("language_pair_unsupported", "This language pair is not supported.")
            continue
        try:
            result = await asyncio.wait_for(
                provider.translate(text, source, target, glossary=glossary, context=context),
                timeout=get_settings().provider_timeout_seconds + 5,
            )
            translation_cache.set(key, result)
            return result
        except TimeoutError:
            last = ProviderError("provider_timeout", "Translation timed out.", retryable=True)
        except ProviderError as exc:
            last = exc
    assert last is not None
    raise last


async def _translate_one(
    u: Utterance, target: str, glossary: list[GlossaryEntry], glossary_version: int, context: TranslationContext
) -> tuple[TranslationResult | None, str | None, int]:
    started = time.monotonic()
    try:
        result = await translate_text(u.original_text or "", u.source_language or "en", target, glossary,
                                      glossary_version, context)
        return result, None, int((time.monotonic() - started) * 1000)
    except ProviderError as exc:
        log_event(log, "translation.failed", room_id=u.room_id, utterance_id=u.id, target=target, code=exc.code)
        return None, exc.code, int((time.monotonic() - started) * 1000)
