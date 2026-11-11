"""Room REST endpoints. All room content endpoints require a guest token and
membership of that specific room."""

from __future__ import annotations

import io
import wave

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Membership, active_member, http_error, member, owner
from app.core.config import get_settings
from app.core.ratelimit import client_ip, limiter
from app.core.security import issue_guest_token, normalize_join_code
from app.db.session import SessionLocal, get_db
from app.models import Room, RoomGlossary, RoomParticipant, Translation, Utterance, utcnow
from app.providers.base import AudioInput, ProviderError
from app.realtime.hub import emit, hub
from app.schemas.api import (
    RETENTION_HOURS,
    CreateRoomRequest,
    GlossaryIn,
    GlossaryOut,
    JoinRoomRequest,
    ParticipantOut,
    RoomOut,
    RoomPreview,
    SessionResponse,
    TextUtteranceRequest,
    TranscriptOut,
    TranslationOut,
    UpdateMeRequest,
    UpdateRoomRequest,
    UsageOut,
    UtteranceOut,
)
from app.services import pipeline, rooms, usage
from app.services.pipeline import Submission, utterance_out
from app.services.usage import QuotaExceeded

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


def _session(room: Room, p: RoomParticipant) -> SessionResponse:
    token, exp = issue_guest_token(p.id, room.id, p.role)
    return SessionResponse(token=token, token_expires_at=exp, room=rooms.room_out(room),
                           participant=rooms.participant_out(p))


def _raise_room_error(exc: rooms.RoomError):
    raise http_error(exc.status, exc.code, exc.message) from exc


# --- Lifecycle -------------------------------------------------------------

@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_room(req: CreateRoomRequest, request: Request, db: AsyncSession = Depends(get_db)):
    limiter.check(f"create:{client_ip(request)}", get_settings().rate_create_room_per_hour, 3600)
    try:
        room, p = await rooms.create_room(db, req)
    except rooms.RoomError as exc:
        _raise_room_error(exc)
    return _session(room, p)


@router.get("/preview/{code}", response_model=RoomPreview)
async def preview(code: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Minimal pre-join info, so the join screen can show languages and retention
    before asking for a name. Rate limited like joins to resist code guessing."""
    limiter.check(f"join:{client_ip(request)}", get_settings().rate_join_per_minute * 2, 60)
    room = await rooms.find_room_by_code(db, normalize_join_code(code))
    if not room:
        raise http_error(404, "room_not_found", "No conversation matches that code.")
    active = (await db.execute(select(RoomParticipant.preferred_language).where(
        RoomParticipant.room_id == room.id, RoomParticipant.left_at.is_(None)))).scalars().all()
    closed = room.status != "active" or rooms.is_expired(room)
    return RoomPreview(
        name=room.name, status="ended" if closed else "active", participant_count=len(active),
        languages_in_use=sorted(set(active)), allowed_languages=room.allowed_languages,
        transcript_retention_mode=room.transcript_retention_mode, summaries_enabled=room.summaries_enabled,
        voice_playback_enabled=room.voice_playback_enabled, full=len(active) >= room.max_participants,
    )


@router.post("/join", response_model=SessionResponse)
async def join_room(req: JoinRoomRequest, request: Request, db: AsyncSession = Depends(get_db)):
    limiter.check(f"join:{client_ip(request)}", get_settings().rate_join_per_minute, 60)
    room = await rooms.find_room_by_code(db, normalize_join_code(req.join_code))
    if not room:
        raise http_error(404, "room_not_found", "No conversation matches that code.")
    try:
        p = await rooms.join_room(db, room, req)
    except rooms.RoomError as exc:
        _raise_room_error(exc)
    return _session(room, p)


@router.post("/{room_id}/token/refresh", response_model=SessionResponse)
async def refresh_token(m: Membership = Depends(member)):
    if m.room.status != "active":
        raise http_error(410, "room_closed", "This conversation has ended.")
    return _session(m.room, m.participant)


@router.get("/{room_id}", response_model=RoomOut)
async def get_room(m: Membership = Depends(member)):
    return rooms.room_out(m.room)


@router.patch("/{room_id}", response_model=RoomOut)
async def update_room(req: UpdateRoomRequest, m: Membership = Depends(owner), db: AsyncSession = Depends(get_db)):
    data = req.model_dump(exclude_unset=True)
    if "allowed_languages" in data:
        enabled = get_settings().enabled_language_codes
        data["allowed_languages"] = [x for x in data["allowed_languages"] if x in enabled]
        if not data["allowed_languages"]:
            raise http_error(422, "no_languages", "At least one language must remain enabled.")
    for k, v in data.items():
        setattr(m.room, k, v)
    await db.commit()
    out = rooms.room_out(m.room)
    await emit("room.updated", m.room.id, participant_id=m.participant.id, payload=out.model_dump(mode="json"))
    return out


@router.post("/{room_id}/end", response_model=RoomOut)
async def end_room(m: Membership = Depends(owner), db: AsyncSession = Depends(get_db)):
    await rooms.end_room(db, m.room)
    return rooms.room_out(m.room)


@router.post("/{room_id}/leave", status_code=204)
async def leave_room(m: Membership = Depends(member), db: AsyncSession = Depends(get_db)):
    m.participant.left_at = utcnow()
    await db.commit()
    await emit("participant.left", m.room.id, participant_id=m.participant.id,
               payload={"display_name": m.participant.display_name})
    return Response(status_code=204)


@router.delete("/{room_id}/history", status_code=200)
async def delete_history(scope: str = "room", m: Membership = Depends(member), db: AsyncSession = Depends(get_db)):
    """scope=room (owner only): delete all transcript content.
    scope=mine: delete only your own utterances and their translations."""
    if scope == "room":
        if not m.is_owner:
            raise http_error(403, "owner_only", "Only the room owner can delete the whole history.")
        n = await rooms.purge_room_content(db, m.room.id)
    elif scope == "mine":
        n = await rooms.purge_room_content(db, m.room.id, participant_id=m.participant.id)
    else:
        raise http_error(422, "bad_scope", "scope must be 'room' or 'mine'.")
    await emit("utterance.deleted", m.room.id, participant_id=m.participant.id,
               payload={"scope": scope, "participant_id": m.participant.id})
    return {"deleted_utterances": n}


# --- Participants -----------------------------------------------------------

@router.get("/{room_id}/participants", response_model=list[ParticipantOut])
async def list_participants(m: Membership = Depends(member), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(RoomParticipant).where(
        RoomParticipant.room_id == m.room.id, RoomParticipant.left_at.is_(None)
    ).order_by(RoomParticipant.joined_at))).scalars().all()
    online = hub.online_ids(m.room.id)
    return [rooms.participant_out(p, online) for p in rows]


@router.patch("/{room_id}/participants/me", response_model=ParticipantOut)
async def update_me(req: UpdateMeRequest, request: Request, m: Membership = Depends(active_member),
                    db: AsyncSession = Depends(get_db)):
    limiter.check(f"write:{m.participant.id}", get_settings().rate_write_per_minute, 60)
    data = req.model_dump(exclude_unset=True)
    for field in ("preferred_language", "spoken_language"):
        if data.get(field) and data[field] not in m.room.allowed_languages:
            raise http_error(422, "language_not_allowed", "The room owner has not enabled that language.")
    for k, v in data.items():
        setattr(m.participant, k, v)
    await db.commit()
    out = rooms.participant_out(m.participant)
    await emit("participant.updated", m.room.id, participant_id=m.participant.id, payload=out.model_dump(mode="json"))
    return out


@router.get("/{room_id}/usage", response_model=UsageOut)
async def get_usage(m: Membership = Depends(member), db: AsyncSession = Depends(get_db)):
    return await usage.summary(db, m.room.id, m.participant.id)


# --- Utterances -------------------------------------------------------------

async def _submit(db: AsyncSession, sub: Submission) -> UtteranceOut:
    try:
        u, created = await pipeline.create_utterance(db, sub)
    except QuotaExceeded as exc:
        raise http_error(429, exc.code, exc.message) from exc
    if created:
        pipeline.start_processing(SessionLocal, u.id, sub.audio)
    translations = (await db.execute(select(Translation).where(Translation.utterance_id == u.id))).scalars().all()
    return utterance_out(u, sub.participant.display_name, list(translations))


@router.post("/{room_id}/utterances", response_model=UtteranceOut, status_code=202)
async def submit_text_utterance(req: TextUtteranceRequest, m: Membership = Depends(active_member),
                                db: AsyncSession = Depends(get_db)):
    """Typed text, or text recognised on-device by the browser (input_mode=voice_browser)."""
    s = get_settings()
    limiter.check(f"utt:{m.participant.id}", s.rate_utterance_per_minute, 60)
    if len(req.text) > s.max_text_chars:
        raise http_error(413, "text_too_long", f"Messages are limited to {s.max_text_chars} characters.")
    src = req.source_language or m.participant.spoken_language or m.participant.preferred_language
    if src not in m.room.allowed_languages:
        raise http_error(422, "language_not_allowed", "That language is not enabled in this room.")
    return await _submit(db, Submission(
        room=m.room, participant=m.participant, idempotency_key=req.idempotency_key, input_mode=req.input_mode,
        text=req.text.strip(), source_language=src, confidence=req.recognition_confidence,
        audio_duration_ms=req.audio_duration_ms,
    ))


def _wav_duration_ms(data: bytes) -> tuple[int, int]:
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise ValueError
            return int(w.getnframes() / w.getframerate() * 1000), w.getframerate()
    except (wave.Error, EOFError, ValueError) as exc:
        raise http_error(415, "unsupported_audio", "Audio must be 16-bit mono WAV.") from exc


@router.post("/{room_id}/utterances/audio", response_model=UtteranceOut, status_code=202)
async def submit_audio_utterance(
    m: Membership = Depends(active_member),
    db: AsyncSession = Depends(get_db),
    audio: UploadFile = File(...),
    idempotency_key: str = Form(..., min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
    source_language: str | None = Form(default=None),
):
    """Audio for server-side recognition. Audio is held in memory only for the
    duration of the provider call and is never written to storage."""
    from app.providers.registry import providers

    s = get_settings()
    limiter.check(f"utt:{m.participant.id}", s.rate_utterance_per_minute, 60)
    if providers().stt is None:
        raise http_error(409, "stt_browser_mode", "This server uses on-device speech recognition.")
    data = await audio.read(s.max_audio_bytes + 1)
    if len(data) > s.max_audio_bytes:
        raise http_error(413, "audio_too_large", "That recording is too long.")
    test_mode = s.bridge_env == "test" and (audio.content_type or "").startswith("text/")
    duration_ms, rate = (1000, 16000) if test_mode else _wav_duration_ms(data)
    if duration_ms > (s.max_utterance_seconds + 1) * 1000:
        raise http_error(413, "audio_too_long", f"Recordings are limited to {s.max_utterance_seconds} seconds.")
    if duration_ms < 250:
        raise http_error(422, "audio_too_short", "That recording was too short.")
    src = source_language or m.participant.spoken_language or m.participant.preferred_language
    if src not in m.room.allowed_languages:
        raise http_error(422, "language_not_allowed", "That language is not enabled in this room.")
    return await _submit(db, Submission(
        room=m.room, participant=m.participant, idempotency_key=idempotency_key, input_mode="voice_server",
        audio=AudioInput(data=data, content_type="audio/wav", sample_rate=rate, duration_ms=duration_ms),
        source_language=src, audio_duration_ms=duration_ms,
    ))


@router.post("/{room_id}/utterances/{utterance_id}/translations", response_model=TranslationOut)
async def translate_on_demand(utterance_id: str, target_language: str, m: Membership = Depends(active_member),
                              db: AsyncSession = Depends(get_db)):
    """Translate one utterance into a language on demand (after a language
    change) or retry a failed translation. Not applied to whole history."""
    limiter.check(f"utt:{m.participant.id}", get_settings().rate_utterance_per_minute, 60)
    if target_language not in m.room.allowed_languages:
        raise http_error(422, "language_not_allowed", "That language is not enabled in this room.")
    u = await db.get(Utterance, utterance_id)
    if not u or u.room_id != m.room.id or not u.original_text:
        raise http_error(404, "utterance_not_found", "Message not found.")
    existing = (await db.execute(select(Translation).where(
        Translation.utterance_id == u.id, Translation.target_language == target_language))).scalar_one_or_none()
    if existing and existing.quality_status != "failed":
        return TranslationOut.model_validate(existing)
    if target_language == u.source_language:
        raise http_error(422, "same_language", "This message is already in that language.")
    glossary = await pipeline._glossary(db, m.room.id)
    context = await pipeline._context(db, u, m.room)
    result, code, latency = await pipeline._translate_one(u, target_language, glossary, m.room.glossary_version, context)
    if existing:
        await db.delete(existing)
        await db.flush()
    t = Translation(
        utterance_id=u.id, target_language=target_language,
        translated_text=result.text if result else None,
        provider=result.provider if result else pipeline.providers().translation.name,
        quality_status=("uncertain" if result.uncertain else "translated") if result else "failed",
        quality_note=(result.note if result else code), glossary_terms=result.glossary_terms_applied if result else [],
        latency_ms=latency,
    )
    db.add(t)
    await db.commit()
    out = TranslationOut.model_validate(t)
    await emit("translation.ready" if result else "translation.failed", m.room.id, participant_id=u.participant_id,
               utterance_id=u.id, sequence_number=u.sequence_number, payload=out.model_dump(mode="json"))
    return out


@router.get("/{room_id}/transcript", response_model=TranscriptOut)
async def transcript(after_seq: int = 0, limit: int = 200, m: Membership = Depends(member),
                     db: AsyncSession = Depends(get_db)):
    limit = max(1, min(limit, 500))
    rows = (await db.execute(
        select(Utterance, RoomParticipant.display_name)
        .join(RoomParticipant, RoomParticipant.id == Utterance.participant_id)
        .where(Utterance.room_id == m.room.id, Utterance.sequence_number > after_seq)
        .order_by(Utterance.sequence_number).limit(limit)
    )).all()
    ids = [u.id for u, _ in rows]
    trs: dict[str, list[Translation]] = {}
    if ids:
        for t in (await db.execute(select(Translation).where(Translation.utterance_id.in_(ids)))).scalars():
            trs.setdefault(t.utterance_id, []).append(t)
    mode = m.room.transcript_retention_mode
    notice = (
        "Transcript is not retained: it is deleted when the room ends."
        if mode == "ephemeral"
        else f"Transcript is retained for {RETENTION_HOURS[mode]} hours after the room ends and is visible only to "
             "people who joined this room. The owner can delete it at any time."
    )
    return TranscriptOut(room=rooms.room_out(m.room), retention_notice=notice,
                         utterances=[utterance_out(u, name, trs.get(u.id, [])) for u, name in rows])


# --- Glossary ---------------------------------------------------------------

@router.get("/{room_id}/glossary", response_model=list[GlossaryOut])
async def list_glossary(m: Membership = Depends(member), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(RoomGlossary).where(RoomGlossary.room_id == m.room.id)
                             .order_by(RoomGlossary.created_at))).scalars().all()
    return [GlossaryOut.model_validate(r) for r in rows]


async def add_glossary_term(db: AsyncSession, m: Membership, req: GlossaryIn) -> RoomGlossary:
    count = len((await db.execute(select(RoomGlossary.id).where(RoomGlossary.room_id == m.room.id))).all())
    if count >= 200:
        raise http_error(409, "glossary_full", "This room's glossary is full.")
    entry = RoomGlossary(room_id=m.room.id, created_by=m.participant.id,
                         status="approved" if m.is_owner else "suggested", **req.model_dump())
    db.add(entry)
    if entry.status == "approved":
        m.room.glossary_version += 1
    await db.commit()
    await emit("glossary.updated", m.room.id, participant_id=m.participant.id,
               payload={"glossary_version": m.room.glossary_version, "entry": GlossaryOut.model_validate(entry).model_dump(mode="json")})
    return entry


@router.post("/{room_id}/glossary", response_model=GlossaryOut, status_code=201)
async def create_glossary(req: GlossaryIn, m: Membership = Depends(active_member), db: AsyncSession = Depends(get_db)):
    """Owners add approved terms; other participants submit suggestions for the owner to approve."""
    limiter.check(f"write:{m.participant.id}", get_settings().rate_write_per_minute, 60)
    return GlossaryOut.model_validate(await add_glossary_term(db, m, req))


@router.post("/{room_id}/glossary/{entry_id}/approve", response_model=GlossaryOut)
async def approve_glossary(entry_id: str, m: Membership = Depends(owner), db: AsyncSession = Depends(get_db)):
    entry = await db.get(RoomGlossary, entry_id)
    if not entry or entry.room_id != m.room.id:
        raise http_error(404, "not_found", "Glossary term not found.")
    entry.status = "approved"
    m.room.glossary_version += 1
    await db.commit()
    await emit("glossary.updated", m.room.id, payload={"glossary_version": m.room.glossary_version})
    return GlossaryOut.model_validate(entry)


@router.delete("/{room_id}/glossary/{entry_id}", status_code=204)
async def delete_glossary(entry_id: str, m: Membership = Depends(owner), db: AsyncSession = Depends(get_db)):
    entry = await db.get(RoomGlossary, entry_id)
    if not entry or entry.room_id != m.room.id:
        raise http_error(404, "not_found", "Glossary term not found.")
    await db.delete(entry)
    m.room.glossary_version += 1
    await db.commit()
    await emit("glossary.updated", m.room.id, payload={"glossary_version": m.room.glossary_version})
    return Response(status_code=204)


