"""Test configuration. Mock providers are used here only (BRIDGE_ENV=test)."""

from __future__ import annotations

import os
import tempfile
import time
import uuid

_tmp = tempfile.mkdtemp(prefix="bridge-test-")
os.environ.update(
    {
        "BRIDGE_ENV": "test",
        "DATABASE_URL": f"sqlite+aiosqlite:///{_tmp}/test.db",
        "SECRET_KEY": "test-secret-key-0123456789abcdef",
        "STT_PROVIDER": "mock",
        "TRANSLATION_PROVIDER": "mock",
        "TTS_PROVIDER": "mock",
        "SUMMARY_PROVIDER": "mock",
        "ENABLED_LANGUAGES": "en,hi,kn,ta,te,ml",
        "STATIC_DIR": "",
        # Never inherit a developer's .env: no fallback provider, no real keys.
        "TRANSLATION_FALLBACK_PROVIDER": "",
        "SARVAM_API_KEY": "",
        "GOOGLE_API_KEY": "",
        "OPENAI_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
        "MYMEMORY_CONTACT_EMAIL": "",
        "CORS_ORIGINS": "http://localhost:3000",
    }
)

import asyncio  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.db.session import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.providers.registry import build_providers, override_providers  # noqa: E402
from app.providers.translation.adapters import MockTranslation  # noqa: E402
from app.services.pipeline import translation_cache  # noqa: E402


async def _reset_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture(autouse=True)
def fresh_state():
    asyncio.run(_reset_db())
    limiter.reset()
    translation_cache.clear()
    MockTranslation.calls = 0
    override_providers(build_providers(get_settings()))
    yield
    override_providers(None)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def create_room(client: TestClient, **overrides) -> dict:
    body = {
        "display_name": "Asha",
        "preferred_language": "en",
        "output_mode": "captions",
        "consent": True,
        "name": "Study group",
        **overrides,
    }
    r = client.post("/api/rooms", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def join_room(client: TestClient, code: str, name: str, lang: str, **overrides) -> dict:
    r = client.post(
        "/api/rooms/join",
        json={"join_code": code, "display_name": name, "preferred_language": lang, "consent": True, **overrides},
    )
    assert r.status_code == 200, r.text
    return r.json()


def auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


def say(client: TestClient, session: dict, text: str, key: str | None = None, **extra):
    return client.post(
        f"/api/rooms/{session['room']['id']}/utterances",
        headers=auth(session),
        json={"idempotency_key": key or uuid.uuid4().hex, "text": text, **extra},
    )


def wait_done(client: TestClient, session: dict, utterance_id: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/rooms/{session['room']['id']}/transcript", headers=auth(session))
        for u in r.json()["utterances"]:
            if u["id"] == utterance_id and u["processing_status"] not in ("processing", "transcribed"):
                return u
        time.sleep(0.05)
    raise AssertionError("utterance did not finish processing")
