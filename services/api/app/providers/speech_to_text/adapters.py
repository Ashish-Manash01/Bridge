"""Server-side speech-to-text adapters.

The browser mode (Web Speech API) runs on the participant's device and is not
an adapter here: the client submits recognised text with input_mode
"voice_browser". All adapters below receive 16 kHz mono WAV from the client.
"""

from __future__ import annotations

import base64

from app.core.config import get_settings
from app.core.languages import locale_for, normalize_language
from app.providers.base import AudioInput, ProviderError, SpeechToTextProvider, TranscriptionResult
from app.providers.http import request, require_key

INDIC_CORE = frozenset({"en", "hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa"})


def _wav_pcm(audio: AudioInput) -> bytes:
    """Strip a canonical 44-byte WAV header if present (Google wants raw LINEAR16)."""
    data = audio.data
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        idx = data.find(b"data", 12)
        if idx != -1:
            return data[idx + 8 :]
    return data


class SarvamSTT(SpeechToTextProvider):
    """Sarvam AI Saarika: Indian languages incl. mixed-language (code-switched) speech."""

    name = "sarvam"
    languages = INDIC_CORE
    detects_language = True
    cost_per_unit = 30 / 3600 / 85  # ~₹30/hour → USD per second (estimate; check current pricing)

    async def transcribe(self, audio: AudioInput, source_language: str | None = None) -> TranscriptionResult:
        s = get_settings()
        key = require_key(s.sarvam_api_key, "SARVAM_API_KEY")
        lang = locale_for(source_language) if source_language else "unknown"
        resp = await request(
            "POST",
            "https://api.sarvam.ai/speech-to-text",
            headers={"api-subscription-key": key},
            data={"model": s.sarvam_stt_model, "language_code": lang},
            files={"file": ("utterance.wav", audio.data, audio.content_type or "audio/wav")},
        )
        body = resp.json()
        text = (body.get("transcript") or "").strip()
        detected = normalize_language(body.get("language_code")) or source_language
        return TranscriptionResult(text=text, language=detected, confidence=None)


class GoogleCloudSTT(SpeechToTextProvider):
    """Google Cloud Speech-to-Text v1 (API key auth)."""

    name = "google"
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa", "ur", "es", "fr", "de", "ar"})
    detects_language = False
    cost_per_unit = 0.016 / 60

    async def transcribe(self, audio: AudioInput, source_language: str | None = None) -> TranscriptionResult:
        s = get_settings()
        key = require_key(s.google_api_key, "GOOGLE_API_KEY")
        lang = source_language or "en"
        payload = {
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": audio.sample_rate or 16000,
                "languageCode": locale_for(lang),
                "enableAutomaticPunctuation": True,
                "model": "default",
            },
            "audio": {"content": base64.b64encode(_wav_pcm(audio)).decode()},
        }
        resp = await request(
            "POST", "https://speech.googleapis.com/v1/speech:recognize", params={"key": key}, json=payload
        )
        results = resp.json().get("results") or []
        texts, confs = [], []
        for r in results:
            alt = (r.get("alternatives") or [{}])[0]
            if alt.get("transcript"):
                texts.append(alt["transcript"].strip())
                if "confidence" in alt:
                    confs.append(float(alt["confidence"]))
        detected = normalize_language(results[0].get("languageCode")) if results else None
        return TranscriptionResult(
            text=" ".join(texts),
            language=detected or lang,
            confidence=(sum(confs) / len(confs)) if confs else None,
        )


class OpenAISTT(SpeechToTextProvider):
    name = "openai"
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa", "ur", "es", "fr", "de", "ar"})
    detects_language = True
    cost_per_unit = 0.006 / 60

    async def transcribe(self, audio: AudioInput, source_language: str | None = None) -> TranscriptionResult:
        s = get_settings()
        key = require_key(s.openai_api_key, "OPENAI_API_KEY")
        data = {"model": s.openai_stt_model, "response_format": "json"}
        if source_language:
            data["language"] = source_language
        resp = await request(
            "POST",
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {key}"},
            data=data,
            files={"file": ("utterance.wav", audio.data, audio.content_type or "audio/wav")},
        )
        body = resp.json()
        return TranscriptionResult(
            text=(body.get("text") or "").strip(),
            language=normalize_language(body.get("language")) or source_language,
        )


class MockSTT(SpeechToTextProvider):
    """Automated tests only. Returns the bytes' UTF-8 text when given text/plain."""

    name = "mock"
    languages = frozenset({"en", "hi", "kn", "ta", "te", "ml"})
    detects_language = False

    async def transcribe(self, audio: AudioInput, source_language: str | None = None) -> TranscriptionResult:
        if audio.data.startswith(b"FAIL"):
            raise ProviderError("provider_unavailable", "mock failure", retryable=True)
        if audio.data.startswith(b"SILENCE"):
            return TranscriptionResult(text="", language=source_language)
        text = audio.data.split(b"|", 1)[-1].decode("utf-8", errors="ignore") if b"|" in audio.data else "mock speech"
        return TranscriptionResult(text=text, language=source_language or "en", confidence=0.93)


def build_stt(name: str) -> SpeechToTextProvider | None:
    return {
        "sarvam": SarvamSTT,
        "google": GoogleCloudSTT,
        "openai": OpenAISTT,
        "mock": MockSTT,
    }.get(name, lambda: None)()
