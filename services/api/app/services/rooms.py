"""Room lifecycle: create, join, end, expire and purge per retention policy."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import log_event
from app.core.security import generate_join_code
from app.models import (
    Room,
    RoomGlossary,
    RoomParticipant,
    RoomSummary,
    Utterance,
    as_utc,
    utcnow,
)
from app.realtime.hub import emit, hub
from app.schemas.api import RETENTION_HOURS, CreateRoomRequest, JoinRoomRequest, ParticipantOut, RoomOut

log = logging.getLogger("bridge.rooms")


class RoomError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def room_out(room: Room) -> RoomOut:
    return RoomOut.model_validate(room)


def participant_out(p: RoomParticipant, online_ids: set[str] | None = None) -> ParticipantOut:
    out = ParticipantOut.model_validate(p)
    out.online = p.id in (online_ids if online_ids is not None else hub.online_ids(p.room_id))
    return out


def is_expired(room: Room) -> bool:
    return as_utc(room.expires_at) <= utcnow()  # type: ignore[operator]


async def create_room(db: AsyncSession, req: CreateRoomRequest) -> tuple[Room, RoomParticipant]:
    s = get_settings()
    enabled = s.enabled_language_codes
    allowed = [lang for lang in (req.allowed_languages or enabled) if lang in enabled]
    if req.preferred_language not in allowed:
        raise RoomError(422, "language_not_enabled", "That language is not enabled on this server.")
    for _ in range(8):
        room = Room(
            join_code=generate_join_code(),
            name=(req.name or f"{req.display_name}'s conversation")[:80],
            topic=req.topic,
            transcript_retention_mode=req.transcript_retention_mode,
            voice_playback_enabled=req.voice_playback_enabled,
            summaries_enabled=req.summaries_enabled,
            allowed_languages=allowed,
            max_participants=s.max_participants_per_room,
            expires_at=utcnow() + timedelta(hours=s.room_ttl_hours),
        )
        db.add(room)
        try:
            await db.flush()
            break
        except IntegrityError:
            await db.rollback()
    else:  # pragma: no cover - astronomically unlikely
        raise RoomError(503, "join_code_exhausted", "Could not allocate a join code. Try again.")

    owner = RoomParticipant(
        room_id=room.id,
        display_name=req.display_name,
        preferred_language=req.preferred_language,
        spoken_language=req.spoken_language or req.preferred_language,
        output_mode=req.output_mode,
        role="owner",
    )
    db.add(owner)
    await db.flush()
    room.owner_participant_id = owner.id
    await db.commit()
    log_event(log, "room.created", room_id=room.id, retention=room.transcript_retention_mode)
    return room, owner


async def find_room_by_code(db: AsyncSession, code: str) -> Room | None:
    return (await db.execute(select(Room).where(Room.join_code == code))).scalar_one_or_none()


async def active_participant_count(db: AsyncSession, room_id: str) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(RoomParticipant).where(
                RoomParticipant.room_id == room_id, RoomParticipant.left_at.is_(None)
            )
        )
    ).scalar_one()


async def join_room(db: AsyncSession, room: Room, req: JoinRoomRequest) -> RoomParticipant:
    if room.status != "active" or is_expired(room):
        raise RoomError(410, "room_closed", "This conversation has ended.")
    if req.preferred_language not in room.allowed_languages:
        raise RoomError(422, "language_not_allowed", "The room owner has not enabled that language.")
    if await active_participant_count(db, room.id) >= room.max_participants:
        raise RoomError(409, "room_full", "This room is full.")
    p = RoomParticipant(
        room_id=room.id,
        display_name=req.display_name,
        preferred_language=req.preferred_language,
        spoken_language=req.spoken_language or req.preferred_language,
        output_mode=req.output_mode,
        role="participant",
    )
    db.add(p)
    await db.commit()
    await emit("participant.joined", room.id, participant_id=p.id, payload=participant_out(p).model_dump(mode="json"))
    log_event(log, "room.joined", room_id=room.id, participant_id=p.id)
    return p


async def purge_room_content(db: AsyncSession, room_id: str, participant_id: str | None = None) -> int:
    """Deletes transcript content. With participant_id, only that person's utterances."""
    q = delete(Utterance).where(Utterance.room_id == room_id)
    if participant_id:
        q = q.where(Utterance.participant_id == participant_id)
    result = await db.execute(q)
    if not participant_id:
        await db.execute(delete(RoomGlossary).where(RoomGlossary.room_id == room_id))
        await db.execute(delete(RoomSummary).where(RoomSummary.room_id == room_id))
    await db.commit()
    return result.rowcount or 0


async def end_room(db: AsyncSession, room: Room, reason: str = "ended_by_owner") -> None:
    if room.status == "ended":
        return
    room.status = "ended"
    room.ended_at = utcnow()
    hours = RETENTION_HOURS.get(room.transcript_retention_mode, 0)
    room.purge_after = room.ended_at + timedelta(hours=hours)
    await db.commit()
    await emit(
        "room.ended",
        room.id,
        payload={
            "reason": reason,
            "retention_mode": room.transcript_retention_mode,
            "purge_after": room.purge_after.isoformat(),
        },
    )
    await hub.close_room(room.id, code=4001)
    if hours == 0:
        await purge_room_content(db, room.id)
    log_event(log, "room.ended", room_id=room.id, reason=reason)


async def sweep_once(db: AsyncSession) -> tuple[int, int]:
    """End expired rooms and purge content whose retention window has passed."""
    now = utcnow()
    expired = (
        (await db.execute(select(Room).where(Room.status == "active", Room.expires_at <= now))).scalars().all()
    )
    for room in expired:
        await end_room(db, room, reason="expired")
    due = (
        (await db.execute(select(Room).where(Room.status == "ended", Room.purge_after <= now))).scalars().all()
    )
    for room in due:
        await purge_room_content(db, room.id)
        # Keep a minimal tombstone (no content, no names) so old links show "ended".
        await db.execute(
            RoomParticipant.__table__.update()
            .where(RoomParticipant.room_id == room.id)
            .values(display_name="(removed)")
        )
        room.purge_after = None
        room.name = "Ended conversation"
        room.topic = None
        await db.commit()
    return len(expired), len(due)


async def sweeper_loop(session_factory, interval: float = 60.0) -> None:
    while True:
        try:
            async with session_factory() as db:
                ended, purged = await sweep_once(db)
                if ended or purged:
                    log_event(log, "retention.sweep", ended=ended, purged=purged)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("retention sweep failed")
        await asyncio.sleep(interval)
