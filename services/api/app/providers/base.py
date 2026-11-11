"""Provider-independent interfaces for speech-to-text, translation and
text-to-speech. Room logic depends only on these types.

Streaming providers should implement separate streaming interfaces
(see StreamingSpeechToTextProvider) instead of overloading one-shot methods.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field


class ProviderError(Exception):
    """Raised by adapters. `code` is safe to show to users and log."""

    def __init__(self, code: str, message: str = "", *, retryable: bool = False) -> None:
        super().__init__(message or code)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class AudioInput:
    data: bytes
    content_type: str  # e.g. audio/wav
    sample_rate: int | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    language: str | None  # BRIDGE base code, None if unknown
    confidence: float | None = None


@dataclass(frozen=True)
class GlossaryEntry:
    source_term: str
    preferred_translation: str | None = None
    source_language: str | None = None
    target_language: str | None = None


@dataclass(frozen=True)
class TranslationContext:
    recent_turns: Sequence[str] = ()  # previous original utterances, oldest first
    topic: str | None = None
    speaker_name: str | None = None


@dataclass(frozen=True)
class TranslationResult:
    text: str
    provider: str
    glossary_terms_applied: list[str] = field(default_factory=list)
    note: str | None = None  # e.g. "glossary hints could not be applied"
    uncertain: bool = False


@dataclass(frozen=True)
class SynthesisResult:
    audio: bytes
    content_type: str


@dataclass(frozen=True)
class SummaryResult:
    summary: str
    decisions: list[str]
    action_items: list[str]
    open_questions: list[str]
    provider: str


class _Provider(ABC):
    name: str = "base"
    #: Base language codes this provider can handle.
    languages: frozenset[str] = frozenset()
    streaming: bool = False
    #: Rough USD cost per unit, for usage/cost tracking only. 0 for free tiers.
    cost_per_unit: float = 0.0

    def supports(self, lang: str) -> bool:
        return lang in self.languages

    async def aclose(self) -> None:  # pragma: no cover - overridden when needed
        return None


class SpeechToTextProvider(_Provider):
    #: Whether transcribe() can identify the language when source_language is None.
    detects_language: bool = False

    @abstractmethod
    async def transcribe(self, audio: AudioInput, source_language: str | None = None) -> TranscriptionResult: ...


class StreamingSpeechToTextProvider(_Provider):
    @abstractmethod
    def stream(
        self, chunks: AsyncIterator[bytes], source_language: str | None = None
    ) -> AsyncIterator[TranscriptionResult]: ...


class TranslationProvider(_Provider):
    #: True when the provider uses glossary/context natively (e.g. LLM prompts).
    native_glossary: bool = False
    uses_context: bool = False

    @abstractmethod
    async def translate(
        self,
        text: str,
        source_language: str,
        target_language: str,
        glossary: Sequence[GlossaryEntry] | None = None,
        context: TranslationContext | None = None,
    ) -> TranslationResult: ...


class TextToSpeechProvider(_Provider):
    @abstractmethod
    async def synthesize(self, text: str, language: str, voice: str | None = None) -> SynthesisResult: ...


class SummaryProvider(_Provider):
    @abstractmethod
    async def summarize(self, transcript: str, language: str) -> SummaryResult: ...
