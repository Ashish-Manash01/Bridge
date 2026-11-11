"""Usage accounting and quota enforcement. Guests can never trigger
unbounded paid provider usage: every paid call is checked against per-room
and per-participant limits first."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import UsageRecord, Utterance
from app.schemas.api import UsageOut


class QuotaExceeded(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def record(
    db: AsyncSession,
    *,
    room_id: str | None,
    participant_id: str | None,
    kind: str,
    provider: str,
    quantity: float,
    unit_cost: float,
) -> None:
    db.add(
        UsageRecord(
            room_id=room_id,
            participant_id=participant_id,
            kind=kind,
            provider=provider,
            quantity=quantity,
            estimated_cost_usd=round(quantity * unit_cost, 6),
        )
    )


async def _sum(db: AsyncSession, room_id: str, kind: str) -> float:
    return float(
        (
            await db.execute(
                select(func.coalesce(func.sum(UsageRecord.quantity), 0)).where(
                    UsageRecord.room_id == room_id, UsageRecord.kind == kind
                )
            )
        ).scalar_one()
    )


async def _utterance_count(db: AsyncSession, participant_id: str) -> int:
    return (
        await db.execute(select(func.count()).select_from(Utterance).where(Utterance.participant_id == participant_id))
    ).scalar_one()


async def check_before_utterance(
    db: AsyncSession, room_id: str, participant_id: str, audio_seconds: float, text_chars: int
) -> None:
    s = get_settings()
    if await _utterance_count(db, participant_id) >= s.max_utterances_per_participant:
        raise QuotaExceeded("participant_quota", "You have reached the message limit for this room.")
    if audio_seconds and (await _sum(db, room_id, "stt_seconds")) + audio_seconds > s.max_audio_seconds_per_room:
        raise QuotaExceeded("room_audio_quota", "This room has used its speech-recognition allowance.")
    if (await _sum(db, room_id, "translate_chars")) + text_chars > s.max_translate_chars_per_room:
        raise QuotaExceeded("room_translation_quota", "This room has used its translation allowance.")


async def summary(db: AsyncSession, room_id: str, participant_id: str) -> UsageOut:
    s = get_settings()
    cost = float(
        (
            await db.execute(
                select(func.coalesce(func.sum(UsageRecord.estimated_cost_usd), 0)).where(UsageRecord.room_id == room_id)
            )
        ).scalar_one()
    )
    return UsageOut(
        audio_seconds_used=round(await _sum(db, room_id, "stt_seconds"), 1),
        audio_seconds_limit=s.max_audio_seconds_per_room,
        translate_chars_used=int(await _sum(db, room_id, "translate_chars")),
        translate_chars_limit=s.max_translate_chars_per_room,
        utterances_by_me=await _utterance_count(db, participant_id),
        utterances_limit_per_participant=s.max_utterances_per_participant,
        estimated_cost_usd=round(cost, 4),
    )
