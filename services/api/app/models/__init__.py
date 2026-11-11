"""ORM models. Schema changes must be accompanied by an Alembic migration."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class TZDateTime(DateTime):
    """Timezone-aware datetime that also round-trips through SQLite."""

    cache_ok = True

    def __init__(self) -> None:
        super().__init__(timezone=True)


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    display_name: Mapped[str] = mapped_column(String(60))
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True)
    preferred_language: Mapped[str] = mapped_column(String(8), default="en")
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, onupdate=utcnow)


class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    join_code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    owner_participant_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(80))
    topic: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active|ended
    default_source_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    transcript_retention_mode: Mapped[str] = mapped_column(String(16), default="ephemeral")
    voice_playback_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    summaries_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    allowed_languages: Mapped[list[str]] = mapped_column(JSON, default=list)
    max_participants: Mapped[int] = mapped_column(Integer, default=12)
    glossary_version: Mapped[int] = mapped_column(Integer, default=0)
    next_sequence: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime(), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)
    purge_after: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True, index=True)

    participants: Mapped[list[RoomParticipant]] = relationship(
        back_populates="room", cascade="all, delete-orphan", passive_deletes=True
    )


class RoomParticipant(Base):
    __tablename__ = "room_participants"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    display_name: Mapped[str] = mapped_column(String(40))
    preferred_language: Mapped[str] = mapped_column(String(8))
    spoken_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    output_mode: Mapped[str] = mapped_column(String(16), default="captions")  # captions|audio|both
    audio_muted: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[str] = mapped_column(String(16), default="participant")  # owner|participant
    consented_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    joined_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    left_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)

    room: Mapped[Room] = relationship(back_populates="participants")


class Utterance(Base):
    __tablename__ = "utterances"
    __table_args__ = (
        UniqueConstraint("room_id", "sequence_number", name="uq_utterance_room_seq"),
        UniqueConstraint("participant_id", "idempotency_key", name="uq_utterance_idempotency"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("room_participants.id", ondelete="CASCADE"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(64))
    input_mode: Mapped[str] = mapped_column(String(16))  # voice_server|voice_browser|text
    source_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    original_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    recognition_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    stt_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    audio_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processing_status: Mapped[str] = mapped_column(String(16), default="processing")
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    sequence_number: Mapped[int] = mapped_column(Integer)

    translations: Mapped[list[Translation]] = relationship(
        back_populates="utterance", cascade="all, delete-orphan", passive_deletes=True
    )


class Translation(Base):
    __tablename__ = "translations"
    __table_args__ = (UniqueConstraint("utterance_id", "target_language", name="uq_translation_target"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    utterance_id: Mapped[str] = mapped_column(ForeignKey("utterances.id", ondelete="CASCADE"), index=True)
    target_language: Mapped[str] = mapped_column(String(8))
    translated_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider: Mapped[str] = mapped_column(String(32))
    quality_status: Mapped[str] = mapped_column(String(16))  # translated|uncertain|failed
    quality_note: Mapped[str | None] = mapped_column(String(120), nullable=True)
    glossary_terms: Mapped[list[str]] = mapped_column(JSON, default=list)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)

    utterance: Mapped[Utterance] = relationship(back_populates="translations")


class RoomGlossary(Base):
    __tablename__ = "room_glossary"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    source_term: Mapped[str] = mapped_column(String(80))
    preferred_translation: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    target_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    note: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="approved")  # approved|suggested
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class TranslationFeedback(Base):
    __tablename__ = "translation_feedback"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    translation_id: Mapped[str | None] = mapped_column(
        ForeignKey("translations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    utterance_id: Mapped[str] = mapped_column(ForeignKey("utterances.id", ondelete="CASCADE"), index=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("room_participants.id", ondelete="CASCADE"))
    feedback_type: Mapped[str] = mapped_column(String(24))  # incorrect|unclear|repeat_request|helpful
    suggested_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class RoomSummary(Base):
    __tablename__ = "room_summaries"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    room_id: Mapped[str] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    language: Mapped[str] = mapped_column(String(8))
    summary: Mapped[str] = mapped_column(Text)
    action_items_json: Mapped[dict] = mapped_column(JSON, default=dict)
    generated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    model_provider: Mapped[str] = mapped_column(String(48))


class UsageRecord(Base):
    __tablename__ = "usage_records"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    room_id: Mapped[str | None] = mapped_column(ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True, index=True)
    participant_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str] = mapped_column(String(24))  # stt_seconds|translate_chars|tts_chars|llm_tokens
    provider: Mapped[str] = mapped_column(String(32))
    quantity: Mapped[float] = mapped_column(Float)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, index=True)
