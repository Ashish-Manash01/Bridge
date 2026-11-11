"""Application settings, loaded from environment variables (see /.env.example)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_DIR = Path(__file__).resolve().parents[2]  # services/api

SttProviderName = Literal["browser", "sarvam", "google", "openai", "mock"]
TranslationProviderName = Literal["mymemory", "sarvam", "google", "openai", "anthropic", "mock"]
TtsProviderName = Literal["browser", "sarvam", "google", "openai", "mock"]
SummaryProviderName = Literal["none", "anthropic", "openai", "mock"]


class Settings(BaseSettings):
    # Repo-root .env, then services/api/.env (later wins). Real environment
    # variables always override both (that's how hosts like Render inject config).
    model_config = SettingsConfigDict(
        env_file=(_API_DIR.parent.parent / ".env", _API_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # --- Runtime -----------------------------------------------------------
    bridge_env: Literal["development", "staging", "production", "test"] = "development"
    secret_key: str = Field(default="dev-insecure-change-me", min_length=16)
    database_url: str = "sqlite+aiosqlite:///./bridge.db"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    public_web_url: str = ""  # used to build share links; falls back to request origin
    static_dir: str = ""  # optional: serve the exported Next.js build from here
    log_level: str = "INFO"

    # --- Providers ---------------------------------------------------------
    stt_provider: SttProviderName = "browser"
    translation_provider: TranslationProviderName = "mymemory"
    translation_fallback_provider: TranslationProviderName | Literal[""] = ""
    tts_provider: TtsProviderName = "browser"
    summary_provider: SummaryProviderName = "none"
    allow_mock_providers: bool = False

    sarvam_api_key: str = ""
    sarvam_stt_model: str = "saarika:v2.5"
    sarvam_translate_model: str = "mayura:v1"
    # mayura modes: formal (native script throughout) | classic-colloquial | modern-colloquial (heavy English mixing)
    sarvam_translate_mode: str = "formal"
    sarvam_tts_model: str = "bulbul:v3"
    sarvam_tts_speaker: str = ""  # empty = provider default voice; bulbul:v3 names e.g. priya, kavya, rahul

    google_api_key: str = ""

    openai_api_key: str = ""
    openai_stt_model: str = "gpt-4o-transcribe"
    openai_text_model: str = "gpt-4o-mini"
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "alloy"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-5-5"

    mymemory_contact_email: str = ""  # optional operator email: raises MyMemory's free quota

    provider_timeout_seconds: float = 15.0

    # --- Languages ---------------------------------------------------------
    enabled_languages: str = "en,hi,kn,ta,te,ml"

    # --- Limits & cost controls ------------------------------------------
    guest_token_ttl_minutes: int = 240
    room_ttl_hours: int = 6
    max_participants_per_room: int = 12
    max_utterance_seconds: int = 30
    max_audio_bytes: int = 2_000_000
    max_text_chars: int = 600
    max_utterances_per_participant: int = 300
    max_audio_seconds_per_room: int = 3600
    max_translate_chars_per_room: int = 200_000
    translation_context_turns: int = 4
    translation_cache_ttl_seconds: int = 900
    translation_cache_max_entries: int = 2000
    tts_cache_max_entries: int = 64

    rate_create_room_per_hour: int = 20
    rate_join_per_minute: int = 12
    rate_utterance_per_minute: int = 20
    rate_write_per_minute: int = 40

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        # Hosts hand out postgres:// or postgresql:// URLs; BRIDGE needs the asyncpg driver.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+asyncpg://" + v[len(prefix):]
        return v

    @field_validator("enabled_languages")
    @classmethod
    def _strip_langs(cls, v: str) -> str:
        return ",".join(p.strip() for p in v.split(",") if p.strip())

    @property
    def enabled_language_codes(self) -> list[str]:
        return self.enabled_languages.split(",")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.bridge_env == "production"

    def uses_mock(self) -> bool:
        return "mock" in (
            self.stt_provider,
            self.translation_provider,
            self.tts_provider,
            self.summary_provider,
        )


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.uses_mock() and not (s.allow_mock_providers or s.bridge_env == "test"):
        raise RuntimeError(
            "Mock providers are configured but ALLOW_MOCK_PROVIDERS is not true. "
            "Mock mode is for automated tests only."
        )
    if s.is_production and s.secret_key.startswith("dev-insecure"):
        raise RuntimeError("SECRET_KEY must be set to a strong random value in production.")
    return s
