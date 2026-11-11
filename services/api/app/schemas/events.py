"""Typed real-time events. Every server→client message is an EventEnvelope.

See docs/api.md#realtime-events for the full catalogue and payload shapes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EventType = Literal[
    "connection.status",
    "room.snapshot",
    "room.updated",
    "room.ended",
    "participant.joined",
    "participant.updated",
    "participant.left",
    "participant.presence",
    "utterance.started",
    "utterance.stopped",
    "utterance.processing",
    "utterance.transcribed",
    "utterance.failed",
    "utterance.deleted",
    "translation.ready",
    "translation.failed",
    "translation.feedback",
    "playback.started",
    "playback.stopped",
    "glossary.updated",
    "summary.ready",
    "floor.busy",
    "error",
    "pong",
]


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: EventType
    event_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    room_id: str
    ts: datetime = Field(default_factory=lambda: datetime.now(UTC))
    participant_id: str | None = None
    utterance_id: str | None = None
    sequence_number: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


ClientMessageType = Literal["ping", "floor.request", "floor.release", "playback.started", "playback.stopped"]


class ClientMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ClientMessageType
    utterance_id: str | None = Field(default=None, max_length=32)
