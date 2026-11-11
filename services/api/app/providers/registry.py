"""Builds the configured providers. Business logic asks the registry for an
interface; it never imports a vendor adapter directly."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings, get_settings
from app.providers.base import (
    ProviderError,
    SpeechToTextProvider,
    SummaryProvider,
    SummaryResult,
    TextToSpeechProvider,
    TranslationProvider,
)
from app.providers.llm import SUMMARY_SYSTEM, parse_json_object, summary_prompt
from app.providers.speech_to_text.adapters import build_stt
from app.providers.text_to_speech.adapters import build_tts
from app.providers.translation.adapters import ALL, anthropic_complete, build_translation


def _to_summary(data: dict, provider: str) -> SummaryResult:
    def strs(key: str) -> list[str]:
        return [str(x) for x in data.get(key, []) if str(x).strip()][:20]

    return SummaryResult(
        summary=str(data.get("summary", "")).strip(),
        decisions=strs("decisions"),
        action_items=strs("action_items"),
        open_questions=strs("open_questions"),
        provider=provider,
    )


class AnthropicSummary(SummaryProvider):
    name = "anthropic"
    languages = ALL

    async def summarize(self, transcript: str, language: str) -> SummaryResult:
        raw = await anthropic_complete(SUMMARY_SYSTEM, summary_prompt(transcript, language), max_tokens=1500)
        return _to_summary(parse_json_object(raw), f"anthropic:{get_settings().anthropic_model}")


class OpenAISummary(SummaryProvider):
    name = "openai"
    languages = ALL

    async def summarize(self, transcript: str, language: str) -> SummaryResult:
        tr = build_translation("openai")
        raw = await tr._complete(SUMMARY_SYSTEM, summary_prompt(transcript, language))  # type: ignore[union-attr]
        return _to_summary(parse_json_object(raw), f"openai:{get_settings().openai_text_model}")


class MockSummary(SummaryProvider):
    name = "mock"
    languages = ALL

    async def summarize(self, transcript: str, language: str) -> SummaryResult:
        lines = [line for line in transcript.splitlines() if line.strip()]
        return SummaryResult(f"Mock summary of {len(lines)} turns.", [], [], [], "mock")


@dataclass
class Providers:
    stt: SpeechToTextProvider | None  # None => browser (on-device) recognition
    translation: TranslationProvider
    translation_fallback: TranslationProvider | None
    tts: TextToSpeechProvider | None  # None => browser speech synthesis
    summary: SummaryProvider | None


def build_providers(s: Settings) -> Providers:
    translation = build_translation(s.translation_provider)
    if translation is None:
        raise ProviderError("provider_not_configured", "Unknown TRANSLATION_PROVIDER")
    fallback = build_translation(s.translation_fallback_provider) if s.translation_fallback_provider else None
    summary = {"anthropic": AnthropicSummary, "openai": OpenAISummary, "mock": MockSummary}.get(s.summary_provider)
    return Providers(
        stt=build_stt(s.stt_provider),
        translation=translation,
        translation_fallback=fallback,
        tts=build_tts(s.tts_provider),
        summary=summary() if summary else None,
    )


_providers: Providers | None = None


def providers() -> Providers:
    global _providers
    if _providers is None:
        _providers = build_providers(get_settings())
    return _providers


def override_providers(p: Providers | None) -> None:
    """Test hook."""
    global _providers
    _providers = p
