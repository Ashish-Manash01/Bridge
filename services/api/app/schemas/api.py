"""REST request/response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.languages import LANGUAGES

OutputMode = Literal["captions", "audio", "both"]
RetentionMode = Literal["ephemeral", "retain_24h", "retain_7d"]
FeedbackType = Literal["incorrect", "unclear", "repeat_request", "helpful"]

RETENTION_HOURS: dict[str, int] = {"ephemeral": 0, "retain_24h": 24, "retain_7d": 24 * 7}


def _lang(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.lower()
    if v not in LANGUAGES:
        raise ValueError("unsupported_language")
    return v


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ParticipantPrefs(_In):
    display_name: str = Field(min_length=1, max_length=40)
    preferred_language: str
    spoken_language: str | None = None
    output_mode: OutputMode = "captions"
    consent: bool = Field(description="Participant acknowledged the processing/privacy notice.")

    _v_pref = field_validator("preferred_language")(_lang)
    _v_spoken = field_validator("spoken_language")(_lang)

    @field_validator("consent")
    @classmethod
    def _must_consent(cls, v: bool) -> bool:
        if not v:
            raise ValueError("consent_required")
        return v


class CreateRoomRequest(ParticipantPrefs):
    name: str | None = Field(default=None, max_length=80)
    topic: str | None = Field(default=None, max_length=200)
    transcript_retention_mode: RetentionMode = "ephemeral"
    voice_playback_enabled: bool = True
    summaries_enabled: bool = False
    allowed_languages: list[str] | None = None

    @field_validator("allowed_languages")
    @classmethod
    def _langs(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return sorted({_lang(x) for x in v})  # type: ignore[misc]


class JoinRoomRequest(ParticipantPrefs):
    join_code: str = Field(min_length=4, max_length=16)


class RoomOut(_Out):
    id: str
    join_code: str
    name: str
    topic: str | None
    status: str
    transcript_retention_mode: str
    voice_playback_enabled: bool
    summaries_enabled: bool
    allowed_languages: list[str]
    max_participants: int
    glossary_version: int
    owner_participant_id: str | None
    created_at: datetime
    expires_at: datetime
    ended_at: datetime | None


class RoomPreview(BaseModel):
    """What an unauthenticated visitor with a valid code may see before joining."""

    name: str
    status: str
    participant_count: int
    languages_in_use: list[str]
    allowed_languages: list[str]
    transcript_retention_mode: str
    summaries_enabled: bool
    voice_playback_enabled: bool
    full: bool


class ParticipantOut(_Out):
    id: str
    display_name: str
    preferred_language: str
    spoken_language: str | None
    output_mode: str
    audio_muted: bool
    role: str
    joined_at: datetime
    left_at: datetime | None
    online: bool = False


class SessionResponse(BaseModel):
    token: str
    token_expires_at: datetime
    room: RoomOut
    participant: ParticipantOut


class UpdateMeRequest(_In):
    display_name: str | None = Field(default=None, min_length=1, max_length=40)
    preferred_language: str | None = None
    spoken_language: str | None = None
    output_mode: OutputMode | None = None
    audio_muted: bool | None = None

    _v_pref = field_validator("preferred_language")(_lang)
    _v_spoken = field_validator("spoken_language")(_lang)


class UpdateRoomRequest(_In):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    topic: str | None = Field(default=None, max_length=200)
    voice_playback_enabled: bool | None = None
    transcript_retention_mode: RetentionMode | None = None
    allowed_languages: list[str] | None = None

    @field_validator("allowed_languages")
    @classmethod
    def _langs(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else sorted({_lang(x) for x in v})  # type: ignore[misc]


class TextUtteranceRequest(_In):
    idempotency_key: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    text: str = Field(min_length=1)
    input_mode: Literal["text", "voice_browser"] = "text"
    source_language: str | None = None
    recognition_confidence: float | None = Field(default=None, ge=0, le=1)
    audio_duration_ms: int | None = Field(default=None, ge=0, le=120_000)

    _v_src = field_validator("source_language")(_lang)


class TranslationOut(_Out):
    id: str
    utterance_id: str
    target_language: str
    translated_text: str | None
    provider: str
    quality_status: str
    quality_note: str | None
    glossary_terms: list[str]
    latency_ms: int | None
    created_at: datetime


class UtteranceOut(_Out):
    id: str
    room_id: str
    participant_id: str
    speaker_name: str
    sequence_number: int
    input_mode: str
    source_language: str | None
    original_text: str | None
    recognition_confidence: float | None
    stt_provider: str | None
    processing_status: str
    error_code: str | None
    created_at: datetime
    translations: list[TranslationOut] = []


class TranscriptOut(BaseModel):
    room: RoomOut
    utterances: list[UtteranceOut]
    retention_notice: str


class GlossaryIn(_In):
    source_term: str = Field(min_length=1, max_length=80)
    preferred_translation: str | None = Field(default=None, max_length=120)
    source_language: str | None = None
    target_language: str | None = None
    note: str | None = Field(default=None, max_length=160)

    _v_s = field_validator("source_language")(_lang)
    _v_t = field_validator("target_language")(_lang)


class GlossaryOut(_Out):
    id: str
    source_term: str
    preferred_translation: str | None
    source_language: str | None
    target_language: str | None
    note: str | None
    status: str
    created_by: str | None
    created_at: datetime


class FeedbackIn(_In):
    feedback_type: FeedbackType
    suggested_text: str | None = Field(default=None, max_length=600)
    glossary_suggestion: GlossaryIn | None = None


class FeedbackOut(_Out):
    id: str
    translation_id: str | None
    utterance_id: str
    participant_id: str
    feedback_type: str
    suggested_text: str | None
    created_at: datetime


class SummaryOut(_Out):
    id: str
    language: str
    summary: str
    action_items_json: dict
    generated_at: datetime
    model_provider: str


class SummaryRequest(_In):
    language: str

    _v = field_validator("language")(_lang)


class UsageOut(BaseModel):
    audio_seconds_used: float
    audio_seconds_limit: int
    translate_chars_used: int
    translate_chars_limit: int
    utterances_by_me: int
    utterances_limit_per_participant: int
    estimated_cost_usd: float
