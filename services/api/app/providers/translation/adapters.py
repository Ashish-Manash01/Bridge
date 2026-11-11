"""Translation adapters."""

from __future__ import annotations

import html
import re
from collections.abc import Sequence

from app.core.config import get_settings
from app.core.languages import LANGUAGES, locale_for
from app.providers.base import (
    GlossaryEntry,
    ProviderError,
    TranslationContext,
    TranslationProvider,
    TranslationResult,
)
from app.providers.glossary import translate_with_glossary
from app.providers.http import request, require_key
from app.providers.llm import TRANSLATION_SYSTEM, parse_json_object, translation_prompt

ALL = frozenset(LANGUAGES)


def chunk_text(text: str, max_bytes: int) -> list[str]:
    """Split on sentence boundaries, then words, keeping each chunk under max_bytes UTF-8."""
    sentences = re.split(r"(?<=[.!?।॥])\s+", text.strip())
    chunks: list[str] = []
    cur = ""
    for sentence in sentences:
        for word in sentence.split(" "):
            candidate = f"{cur} {word}".strip() if cur else word
            if len(candidate.encode()) <= max_bytes:
                cur = candidate
            else:
                if cur:
                    chunks.append(cur)
                cur = word  # a single overlong word is sent as-is
        # prefer breaking at sentence ends when the next sentence would overflow
    if cur:
        chunks.append(cur)
    return chunks or [text]


class MyMemoryTranslation(TranslationProvider):
    """MyMemory public API (translated.net). Free with a daily character quota;
    suitable for development and small pilots, not production scale."""

    name = "mymemory"
    languages = ALL
    MAX_BYTES = 480  # API limit is 500 bytes per request

    async def _raw(self, text: str, source: str, target: str) -> str:
        s = get_settings()
        out = []
        for chunk in chunk_text(text, self.MAX_BYTES):
            params = {"q": chunk, "langpair": f"{source}|{target}"}
            if s.mymemory_contact_email:
                params["de"] = s.mymemory_contact_email
            resp = await request("GET", "https://api.mymemory.translated.net/get", params=params)
            body = resp.json()
            if body.get("quotaFinished"):
                raise ProviderError("provider_quota", "The free translation quota is used up for today.")
            if int(body.get("responseStatus", 200)) != 200:
                raise ProviderError("provider_rejected", str(body.get("responseDetails", ""))[:120])
            translated = (body.get("responseData") or {}).get("translatedText") or ""
            if "MYMEMORY WARNING" in translated.upper():
                raise ProviderError("provider_quota", "The free translation quota is used up for today.")
            out.append(html.unescape(translated))
        return " ".join(out).strip()

    async def translate(
        self,
        text: str,
        source_language: str,
        target_language: str,
        glossary: Sequence[GlossaryEntry] | None = None,
        context: TranslationContext | None = None,
    ) -> TranslationResult:
        return await translate_with_glossary(
            text,
            source_language,
            target_language,
            glossary,
            lambda t: self._raw(t, source_language, target_language),
            self.name,
        )


class SarvamTranslation(TranslationProvider):
    name = "sarvam"
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa"})
    cost_per_unit = 20 / 10000 / 85  # ~₹20 per 10K chars (estimate)

    async def _raw(self, text: str, source: str, target: str) -> str:
        s = get_settings()
        key = require_key(s.sarvam_api_key, "SARVAM_API_KEY")
        out = []
        for chunk in chunk_text(text, 900 * 3):
            resp = await request(
                "POST",
                "https://api.sarvam.ai/translate",
                headers={"api-subscription-key": key},
                json={
                    "input": chunk,
                    "source_language_code": locale_for(source),
                    "target_language_code": locale_for(target),
                    "model": s.sarvam_translate_model,
                    # Only mayura accepts a style mode; sarvam-translate is formal-only.
                    **({"mode": s.sarvam_translate_mode} if s.sarvam_translate_model.startswith("mayura") else {}),
                },
            )
            out.append(resp.json().get("translated_text", ""))
        return " ".join(out).strip()

    async def translate(self, text, source_language, target_language, glossary=None, context=None):
        return await translate_with_glossary(
            text, source_language, target_language, glossary,
            lambda t: self._raw(t, source_language, target_language), self.name,
        )


class GoogleCloudTranslation(TranslationProvider):
    name = "google"
    languages = ALL
    cost_per_unit = 20 / 1_000_000

    async def _raw(self, text: str, source: str, target: str) -> str:
        key = require_key(get_settings().google_api_key, "GOOGLE_API_KEY")
        resp = await request(
            "POST",
            "https://translation.googleapis.com/language/translate/v2",
            params={"key": key},
            json={"q": text, "source": source, "target": target, "format": "text"},
        )
        items = resp.json().get("data", {}).get("translations", [])
        if not items:
            raise ProviderError("provider_bad_response", "No translation returned.")
        return html.unescape(items[0]["translatedText"])

    async def translate(self, text, source_language, target_language, glossary=None, context=None):
        return await translate_with_glossary(
            text, source_language, target_language, glossary,
            lambda t: self._raw(t, source_language, target_language), self.name,
        )


class _LLMTranslation(TranslationProvider):
    languages = ALL
    native_glossary = True
    uses_context = True

    async def _complete(self, system: str, user: str) -> str:
        raise NotImplementedError

    async def translate(self, text, source_language, target_language, glossary=None, context=None):
        prompt, candidate_terms = translation_prompt(text, source_language, target_language, glossary, context)
        data = parse_json_object(await self._complete(TRANSLATION_SYSTEM, prompt))
        translation = str(data.get("translation", "")).strip()
        if not translation:
            raise ProviderError("provider_bad_response", "Empty translation.")
        used = [t for t in data.get("glossary_terms_used", []) if t in candidate_terms]
        return TranslationResult(
            translation, self.name, glossary_terms_applied=used, uncertain=bool(data.get("uncertain"))
        )


class OpenAITranslation(_LLMTranslation):
    name = "openai"

    async def _complete(self, system: str, user: str) -> str:
        s = get_settings()
        key = require_key(s.openai_api_key, "OPENAI_API_KEY")
        resp = await request(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": s.openai_text_model,
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
        )
        return resp.json()["choices"][0]["message"]["content"]


class AnthropicTranslation(_LLMTranslation):
    name = "anthropic"

    async def _complete(self, system: str, user: str) -> str:
        return await anthropic_complete(system, user)


async def anthropic_complete(system: str, user: str, max_tokens: int = 1024) -> str:
    s = get_settings()
    key = require_key(s.anthropic_api_key, "ANTHROPIC_API_KEY")
    resp = await request(
        "POST",
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={
            "model": s.anthropic_model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
    )
    blocks = resp.json().get("content", [])
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


class MockTranslation(TranslationProvider):
    """Automated tests only. Deterministic, clearly marked output."""

    name = "mock"
    languages = ALL
    calls = 0

    async def translate(self, text, source_language, target_language, glossary=None, context=None):
        type(self).calls += 1
        if "FAIL:" + target_language in text:
            raise ProviderError("provider_unavailable", "mock failure", retryable=True)

        async def raw(t: str) -> str:
            return f"[{target_language}] {t}"

        return await translate_with_glossary(text, source_language, target_language, glossary, raw, self.name)


def build_translation(name: str) -> TranslationProvider | None:
    return {
        "mymemory": MyMemoryTranslation,
        "sarvam": SarvamTranslation,
        "google": GoogleCloudTranslation,
        "openai": OpenAITranslation,
        "anthropic": AnthropicTranslation,
        "mock": MockTranslation,
    }.get(name, lambda: None)()
