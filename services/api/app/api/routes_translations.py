"""Translation feedback, on-demand speech synthesis and summaries."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Membership, active_member, bearer_claims, http_error, load_membership, member
from app.api.routes_rooms import add_glossary_term
from app.core.config import get_settings
from app.core.ratelimit import limiter
from app.core.security import GuestClaims
from app.db.session import get_db
from app.models import RoomParticipant, RoomSummary, Translation, TranslationFeedback, Utterance
from app.providers.base import ProviderError
from app.providers.registry import providers
from app.realtime.hub import emit
from app.schemas.api import FeedbackIn, FeedbackOut, SummaryOut, SummaryRequest
from app.services import usage
from app.services.caches import TTLCache, cache_key

router = APIRouter(tags=["translations"])

_tts_cache: TTLCache[tuple[bytes, str]] = TTLCache(get_settings().tts_cache_max_entries, 600)


async def _translation_membership(db: AsyncSession, claims: GuestClaims, translation_id: str):
    t = await db.get(Translation, translation_id)
    if not t:
        raise http_error(404, "translation_not_found", "Translation not found.")
    u = await db.get(Utterance, t.utterance_id)
    assert u is not None
    m = await load_membership(db, claims, u.room_id)
    return t, u, m


@router.post("/api/translations/{translation_id}/feedback", response_model=FeedbackOut, status_code=201)
async def translation_feedback(translation_id: str, req: FeedbackIn, claims: GuestClaims = Depends(bearer_claims),
                               db: AsyncSession = Depends(get_db)):
    t, u, m = await _translation_membership(db, claims, translation_id)
    limiter.check(f"write:{m.participant.id}", get_settings().rate_write_per_minute, 60)
    fb = TranslationFeedback(translation_id=t.id, utterance_id=u.id, participant_id=m.participant.id,
                             feedback_type=req.feedback_type, suggested_text=req.suggested_text)
    db.add(fb)
    await db.commit()
    if req.glossary_suggestion and m.room.status == "active":
        await add_glossary_term(db, m, req.glossary_suggestion)
    out = FeedbackOut.model_validate(fb)
    await emit("translation.feedback", m.room.id, participant_id=m.participant.id, utterance_id=u.id,
               sequence_number=u.sequence_number, payload={
                   **out.model_dump(mode="json"), "from_name": m.participant.display_name,
                   "speaker_participant_id": u.participant_id, "target_language": t.target_language})
    return out


@router.post("/api/rooms/{room_id}/utterances/{utterance_id}/repeat", response_model=FeedbackOut, status_code=201)
async def request_repeat(utterance_id: str, m: Membership = Depends(active_member), db: AsyncSession = Depends(get_db)):
    """Ask the speaker to repeat, even when no translation exists (e.g. recognition failed)."""
    limiter.check(f"write:{m.participant.id}", get_settings().rate_write_per_minute, 60)
    u = await db.get(Utterance, utterance_id)
    if not u or u.room_id != m.room.id:
        raise http_error(404, "utterance_not_found", "Message not found.")
    fb = TranslationFeedback(utterance_id=u.id, participant_id=m.participant.id, feedback_type="repeat_request")
    db.add(fb)
    await db.commit()
    out = FeedbackOut.model_validate(fb)
    await emit("translation.feedback", m.room.id, participant_id=m.participant.id, utterance_id=u.id,
               sequence_number=u.sequence_number, payload={
                   **out.model_dump(mode="json"), "from_name": m.participant.display_name,
                   "speaker_participant_id": u.participant_id})
    return out


@router.get("/api/translations/{translation_id}/audio")
async def translation_audio(translation_id: str, claims: GuestClaims = Depends(bearer_claims),
                            db: AsyncSession = Depends(get_db), range_: str | None = Header(default=None, alias="Range")):
    """Synthesise a translation on demand (never pre-generated for everyone).
    Returns 409 when the server is in browser-TTS mode so the client falls back."""
    t, _u, m = await _translation_membership(db, claims, translation_id)
    if not m.room.voice_playback_enabled:
        raise http_error(403, "voice_disabled", "The room owner turned off translated voice.")
    p = providers()
    if p.tts is None:
        raise http_error(409, "tts_browser_mode", "This server uses on-device speech synthesis.")
    if not t.translated_text:
        raise http_error(404, "no_text", "There is no translated text to play.")
    if not p.tts.supports(t.target_language):
        raise http_error(422, "tts_language_unsupported", "Voice is not available for this language.")
    limiter.check(f"tts:{m.participant.id}", 60, 60)
    key = cache_key(p.tts.name, t.id, t.translated_text)
    hit = _tts_cache.get(key)
    if hit is None:
        try:
            result = await p.tts.synthesize(t.translated_text, t.target_language)
        except ProviderError as exc:
            raise http_error(502, exc.code, "Translated voice is unavailable right now. Captions still work.") from exc
        await usage.record(db, room_id=m.room.id, participant_id=m.participant.id, kind="tts_chars",
                           provider=p.tts.name, quantity=len(t.translated_text), unit_cost=p.tts.cost_per_unit)
        await db.commit()
        hit = (result.audio, result.content_type)
        _tts_cache.set(key, hit)
    return Response(content=hit[0], media_type=hit[1], headers={"Cache-Control": "private, max-age=600"})


@router.get("/api/rooms/{room_id}/summary", response_model=SummaryOut | None)
async def latest_summary(m: Membership = Depends(member), db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(RoomSummary).where(RoomSummary.room_id == m.room.id)
                             .order_by(RoomSummary.generated_at.desc()).limit(1))).scalar_one_or_none()


@router.post("/api/rooms/{room_id}/summary", response_model=SummaryOut, status_code=201)
async def generate_summary(req: SummaryRequest, m: Membership = Depends(member), db: AsyncSession = Depends(get_db)):
    if not m.room.summaries_enabled:
        raise http_error(403, "summaries_disabled", "Summaries were not enabled when this room was created.")
    p = providers()
    if p.summary is None:
        raise http_error(501, "summary_not_configured", "Summaries need an AI provider configured on the server.")
    limiter.check(f"summary:{m.room.id}", 5, 3600)
    rows = (await db.execute(
        select(Utterance, RoomParticipant.display_name)
        .join(RoomParticipant, RoomParticipant.id == Utterance.participant_id)
        .where(Utterance.room_id == m.room.id, Utterance.original_text.is_not(None))
        .order_by(Utterance.sequence_number).limit(400))).all()
    if not rows:
        raise http_error(422, "empty_transcript", "There is nothing to summarise yet.")
    ids = [u.id for u, _ in rows]
    en = {t.utterance_id: t.translated_text for t in (await db.execute(select(Translation).where(
        Translation.utterance_id.in_(ids), Translation.target_language == req.language))).scalars()}
    lines = [f"{name}: {u.original_text}" + (f" [{en[u.id]}]" if en.get(u.id) else "") for u, name in rows]
    transcript = "\n".join(lines)[-30000:]
    try:
        result = await p.summary.summarize(transcript, req.language)
    except ProviderError as exc:
        raise http_error(502, exc.code, "The summary could not be generated right now.") from exc
    row = RoomSummary(room_id=m.room.id, language=req.language, summary=result.summary,
                      action_items_json={"decisions": result.decisions, "action_items": result.action_items,
                                         "open_questions": result.open_questions},
                      model_provider=result.provider)
    db.add(row)
    await usage.record(db, room_id=m.room.id, participant_id=m.participant.id, kind="llm_chars",
                       provider=p.summary.name, quantity=len(transcript), unit_cost=0)
    await db.commit()
    out = SummaryOut.model_validate(row)
    await emit("summary.ready", m.room.id, participant_id=m.participant.id, payload=out.model_dump(mode="json"))
    return out
