"""Server-side text-to-speech adapters.

In "browser" mode there is no server adapter: clients use the device's
speechSynthesis voices, whose availability varies by device and is detected
on the client.
"""

from __future__ import annotations

import base64

from app.core.config import get_settings
from app.core.languages import locale_for
from app.providers.base import ProviderError, SynthesisResult, TextToSpeechProvider
from app.providers.http import request, require_key


class SarvamTTS(TextToSpeechProvider):
    name = "sarvam"
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa"})
    cost_per_unit = 15 / 10000 / 85

    async def synthesize(self, text: str, language: str, voice: str | None = None) -> SynthesisResult:
        s = get_settings()
        key = require_key(s.sarvam_api_key, "SARVAM_API_KEY")
        resp = await request(
            "POST",
            "https://api.sarvam.ai/text-to-speech",
            headers={"api-subscription-key": key},
            json={
                "text": text[:1500],
                "target_language_code": locale_for(language),
                "model": s.sarvam_tts_model,
                **({"speaker": voice or s.sarvam_tts_speaker} if (voice or s.sarvam_tts_speaker) else {}),
            },
        )
        audios = resp.json().get("audios") or []
        if not audios:
            raise ProviderError("provider_bad_response", "No audio returned.")
        return SynthesisResult(base64.b64decode(audios[0]), "audio/wav")


class GoogleCloudTTS(TextToSpeechProvider):
    name = "google"
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa", "ur", "es", "fr", "de", "ar"})
    cost_per_unit = 16 / 1_000_000
    _locale_overrides = {"ar": "ar-XA"}

    async def synthesize(self, text: str, language: str, voice: str | None = None) -> SynthesisResult:
        key = require_key(get_settings().google_api_key, "GOOGLE_API_KEY")
        voice_cfg: dict = {"languageCode": self._locale_overrides.get(language, locale_for(language))}
        if voice:
            voice_cfg["name"] = voice
        resp = await request(
            "POST",
            "https://texttospeech.googleapis.com/v1/text:synthesize",
            params={"key": key},
            json={"input": {"text": text[:4500]}, "voice": voice_cfg, "audioConfig": {"audioEncoding": "MP3"}},
        )
        content = resp.json().get("audioContent")
        if not content:
            raise ProviderError("provider_bad_response", "No audio returned.")
        return SynthesisResult(base64.b64decode(content), "audio/mpeg")


class OpenAITTS(TextToSpeechProvider):
    name = "openai"
    # Multilingual voices; naturalness for Indic languages must be evaluated before advertising.
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa", "ur", "es", "fr", "de", "ar"})
    cost_per_unit = 15 / 1_000_000

    async def synthesize(self, text: str, language: str, voice: str | None = None) -> SynthesisResult:
        s = get_settings()
        key = require_key(s.openai_api_key, "OPENAI_API_KEY")
        resp = await request(
            "POST",
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": s.openai_tts_model,
                "voice": voice or s.openai_tts_voice,
                "input": text[:4000],
                "response_format": "mp3",
            },
        )
        return SynthesisResult(resp.content, "audio/mpeg")


class MockTTS(TextToSpeechProvider):
    name = "mock"
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml"})

    async def synthesize(self, text: str, language: str, voice: str | None = None) -> SynthesisResult:
        # 0.1s of silence, valid WAV.
        import io
        import wave

        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00" * 1600)
        return SynthesisResult(buf.getvalue(), "audio/wav")


def build_tts(name: str) -> TextToSpeechProvider | None:
    return {"sarvam": SarvamTTS, "google": GoogleCloudTTS, "openai": OpenAITTS, "mock": MockTTS}.get(
        name, lambda: None
    )()
