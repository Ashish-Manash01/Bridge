from __future__ import annotations

import asyncio

import httpx
import pytest

from app.core.config import Settings, get_settings
from app.providers import http as provider_http
from app.providers.base import GlossaryEntry, ProviderError
from app.providers.glossary import protect, restore, translate_with_glossary
from app.providers.registry import build_providers
from app.providers.translation.adapters import MyMemoryTranslation, SarvamTranslation, chunk_text


def _fake_request(responses):
    calls = []

    async def fake(method, url, **kwargs):
        calls.append((method, url, kwargs))
        status, body = responses.pop(0)
        if isinstance(body, Exception):
            raise body
        resp = httpx.Response(status, json=body, request=httpx.Request(method, url))
        return resp

    return fake, calls


def test_mymemory_success_and_chunking(monkeypatch):
    fake, calls = _fake_request([(200, {"responseStatus": 200, "responseData": {"translatedText": "ನಮಸ್ಕಾರ &amp; ಸ್ವಾಗತ"}})])
    monkeypatch.setattr("app.providers.translation.adapters.request", fake)
    result = asyncio.run(MyMemoryTranslation().translate("Hello and welcome", "en", "kn"))
    assert result.text == "ನಮಸ್ಕಾರ & ಸ್ವಾಗತ"
    assert calls[0][2]["params"]["langpair"] == "en|kn"


def test_mymemory_quota_is_a_provider_error(monkeypatch):
    fake, _ = _fake_request([(200, {"quotaFinished": True, "responseStatus": 200, "responseData": {}})])
    monkeypatch.setattr("app.providers.translation.adapters.request", fake)
    with pytest.raises(ProviderError) as exc:
        asyncio.run(MyMemoryTranslation().translate("Hello", "en", "kn"))
    assert exc.value.code == "provider_quota"


def test_http_error_mapping(monkeypatch):
    class FakeClient:
        is_closed = False

        def __init__(self, exc=None, status=200):
            self.exc, self.status = exc, status

        async def request(self, method, url, **kw):
            if self.exc:
                raise self.exc
            return httpx.Response(self.status, request=httpx.Request(method, url))

    for client, code in [
        (FakeClient(exc=httpx.ReadTimeout("t")), "provider_timeout"),
        (FakeClient(status=429), "provider_rate_limited"),
        (FakeClient(status=401), "provider_auth"),
        (FakeClient(status=503), "provider_unavailable"),
        (FakeClient(status=400), "provider_rejected"),
    ]:
        monkeypatch.setattr(provider_http, "_client", client)
        with pytest.raises(ProviderError) as exc:
            asyncio.run(provider_http.request("GET", "https://example.invalid"))
        assert exc.value.code == code
    monkeypatch.setattr(provider_http, "_client", None)


def test_sarvam_requires_key(monkeypatch):
    monkeypatch.setattr(get_settings(), "sarvam_api_key", "")
    with pytest.raises(ProviderError) as exc:
        asyncio.run(SarvamTranslation().translate("hi", "en", "kn"))
    assert exc.value.code == "provider_not_configured"


def test_chunk_text_respects_byte_limit():
    text = "ಇದು ಒಂದು ಪರೀಕ್ಷಾ ವಾಕ್ಯ. " * 40
    chunks = chunk_text(text, 480)
    assert len(chunks) > 1
    assert all(len(c.encode()) <= 480 for c in chunks)
    assert " ".join(chunks).split() == text.split()


def test_glossary_protect_restore_roundtrip():
    entries = [GlossaryEntry("Jayanagar"), GlossaryEntry("BRIDGE", "ಬ್ರಿಡ್ಜ್")]
    p = protect("Meet at jayanagar for BRIDGE demo", entries)
    assert "jayanagar" not in p.text and "BRIDGE" not in p.text
    assert restore(p.text.upper(), p) == "MEET AT Jayanagar FOR ಬ್ರಿಡ್ಜ್ DEMO"
    assert restore("token lost", p) is None


def test_glossary_falls_back_when_placeholders_lost():
    async def lossy(t: str) -> str:
        return "translated without tokens"

    result = asyncio.run(translate_with_glossary("Meet at Jayanagar", "en", "kn", [GlossaryEntry("Jayanagar")],
                                                 lossy, "x"))
    assert result.glossary_terms_applied == []
    assert result.note and "could not be applied" in result.note


def test_glossary_language_scoping():
    async def echo(t: str) -> str:
        return t

    result = asyncio.run(translate_with_glossary(
        "Meet at Jayanagar", "en", "hi", [GlossaryEntry("Jayanagar", "X", target_language="kn")], echo, "x"))
    assert result.glossary_terms_applied == [] and result.text == "Meet at Jayanagar"


def test_mock_providers_refused_outside_tests():
    get_settings.cache_clear()
    try:
        import os

        os.environ["BRIDGE_ENV"] = "development"
        with pytest.raises(RuntimeError):
            get_settings()
    finally:
        os.environ["BRIDGE_ENV"] = "test"
        get_settings.cache_clear()


def test_browser_modes_have_no_server_adapter():
    p = build_providers(Settings(stt_provider="browser", tts_provider="browser", translation_provider="mymemory",
                                 summary_provider="none"))
    assert p.stt is None and p.tts is None and p.summary is None
    assert p.translation.name == "mymemory"


def test_out_of_credits_is_quota_not_rate_limit(monkeypatch):
    class FakeClient:
        is_closed = False

        async def request(self, method, url, **kw):
            return httpx.Response(429, text='{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}',
                                  request=httpx.Request(method, url))

    monkeypatch.setattr(provider_http, "_client", FakeClient())
    with pytest.raises(ProviderError) as exc:
        asyncio.run(provider_http.request("POST", "https://example.invalid"))
    assert exc.value.code == "provider_quota" and not exc.value.retryable
    monkeypatch.setattr(provider_http, "_client", None)


def test_evaluation_results_only_apply_to_matching_providers(tmp_path, monkeypatch):
    import json

    from app.services import capabilities

    f = tmp_path / "eval.json"
    f.write_text(json.dumps({"providers": {"stt": "sarvam", "translation": "sarvam", "tts": "sarvam"},
                             "languages": {"kn": {"status": "automated_pass"}}}), encoding="utf-8")
    monkeypatch.setattr(capabilities, "EVAL_FILE", f)
    # Test config uses mock providers, so the sarvam results must not be shown.
    assert all(row["tested"] is None for row in capabilities.language_matrix())


def test_tokens_are_redacted_from_logs():
    import logging

    from app.core.logging import RedactTokens

    rec = logging.LogRecord("uvicorn.error", logging.INFO, __file__, 1,
                            '%s - "WebSocket /ws/rooms/abc?token=%s" [accepted]', ("127.0.0.1", "eyJhbGciOi.secret.sig"), None)
    RedactTokens().filter(rec)
    assert "eyJhbGciOi" not in rec.getMessage() and "token=[redacted]" in rec.getMessage()
