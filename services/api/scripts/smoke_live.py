"""Live end-to-end smoke test against a running BRIDGE server with REAL providers.

Simulates three people (English, Kannada, Hindi) over REST + WebSockets:
typed and spoken utterances, per-language delivery, voice playback, glossary,
feedback, idempotency, room end + purge, plus static pages and security headers.

Usage:  python -m scripts.smoke_live [base_url]      (default http://localhost:8000)
It uses provider credits (a few short sentences). Never point it at production data.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
import time
import uuid

import httpx
import websockets

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
WS = BASE.replace("http", "ws", 1)
SCRIPT = {"kn": re.compile(r"[ಀ-೿]"), "hi": re.compile(r"[ऀ-ॿ]"), "en": re.compile(r"[A-Za-z]")}
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""), flush=True)
    return ok


class Listener:
    """Collects a participant's WebSocket events in the background."""

    def __init__(self, room_id: str, token: str) -> None:
        self.url = f"{WS}/ws/rooms/{room_id}?token={token}"
        self.events: list[dict] = []
        self.close_code: int | None = None
        self.task: asyncio.Task | None = None

    async def start(self) -> None:
        self.ws = await websockets.connect(self.url)
        self.task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        try:
            async for raw in self.ws:
                self.events.append(json.loads(raw))
        except websockets.ConnectionClosed as exc:
            self.close_code = exc.rcvd.code if exc.rcvd else None
        self.close_code = self.close_code or (self.ws.close_code if hasattr(self.ws, "close_code") else None)

    async def wait_for(self, pred, timeout: float = 25) -> dict | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for e in self.events:
                if pred(e):
                    return e
            await asyncio.sleep(0.1)
        return None


async def main() -> int:
    c = httpx.AsyncClient(base_url=BASE, timeout=40)
    H = lambda s: {"Authorization": f"Bearer {s['token']}"}  # noqa: E731

    # --- Static app + platform -------------------------------------------------
    h = await c.get("/api/health")
    check("health", h.status_code == 200 and h.json().get("database") is True, h.text[:80])
    for path in ["/", "/new", "/join", "/room", "/transcript", "/languages", "/privacy", "/manifest.webmanifest",
                 "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/sw.js", "/pcm-worklet.js"]:
        r = await c.get(path)
        check(f"serves {path}", r.status_code == 200, str(r.status_code))
    r = await c.get("/does-not-exist")
    check("unknown page → 404", r.status_code == 404)
    r = await c.get("/..%2f..%2f.env")
    check("path traversal blocked", r.status_code == 404 and "SECRET" not in r.text)
    r = await c.get("/api/config")
    cfg = r.json()
    check("security headers", r.headers.get("x-content-type-options") == "nosniff" and r.headers.get("cache-control") == "no-store")
    check("config has no secrets", not re.search(r"sk[-_][A-Za-z0-9]{8}", r.text))
    print("      providers:", cfg["providers"], "| mock:", cfg["mock_mode"])
    tested = {lang["code"]: lang["tested"] for lang in cfg["languages"]}
    check("language matrix shows verification", all(v == "automated_pass" for v in tested.values()), str(tested))

    # --- Room with three languages ----------------------------------------------
    base = {"output_mode": "both", "consent": True}
    a = (await c.post("/api/rooms", json={**base, "display_name": "Asha", "preferred_language": "en", "name": "Smoke test",
                                          "transcript_retention_mode": "ephemeral", "voice_playback_enabled": True})).json()
    code, rid = a["room"]["join_code"], a["room"]["id"]
    check("create room", bool(code) and len(code) == 6, code)
    pv = (await c.get(f"/api/rooms/preview/{code.lower()}")).json()
    check("preview by code", pv.get("status") == "active")
    b = (await c.post("/api/rooms/join", json={**base, "join_code": code, "display_name": "Ravi", "preferred_language": "kn"})).json()
    m = (await c.post("/api/rooms/join", json={**base, "join_code": code, "display_name": "Meera", "preferred_language": "hi"})).json()
    check("two guests joined", "token" in b and "token" in m)

    la, lb, lm = Listener(rid, a["token"]), Listener(rid, b["token"]), Listener(rid, m["token"])
    for listener in (la, lb, lm):
        await listener.start()
    snap = await lb.wait_for(lambda e: e["type"] == "room.snapshot", 5)
    check("websocket snapshot", bool(snap) and len(snap["payload"]["participants"]) == 3)

    # --- Typed utterance: en → kn, hi -------------------------------------------
    key = uuid.uuid4().hex
    t0 = time.monotonic()
    u1 = (await c.post(f"/api/rooms/{rid}/utterances", headers=H(a),
                       json={"idempotency_key": key, "text": "Shall we meet at the library at five o'clock?", "input_mode": "text"})).json()
    kn = await lb.wait_for(lambda e: e["type"] == "translation.ready" and e["payload"]["target_language"] == "kn" and e["utterance_id"] == u1["id"])
    hi = await lm.wait_for(lambda e: e["type"] == "translation.ready" and e["payload"]["target_language"] == "hi" and e["utterance_id"] == u1["id"])
    ms = int((time.monotonic() - t0) * 1000)
    check("Ravi receives Kannada", bool(kn) and bool(SCRIPT["kn"].search(kn["payload"]["translated_text"] or "")), kn and kn["payload"]["translated_text"])
    check("Meera receives Hindi", bool(hi) and bool(SCRIPT["hi"].search(hi["payload"]["translated_text"] or "")), hi and hi["payload"]["translated_text"])
    check("caption latency (typed)", ms < 8000, f"{ms} ms end-to-end")
    dup = (await c.post(f"/api/rooms/{rid}/utterances", headers=H(a),
                        json={"idempotency_key": key, "text": "Shall we meet at the library at five o'clock?", "input_mode": "text"})).json()
    check("duplicate submission ignored", dup["id"] == u1["id"])

    # --- Spoken utterance: real Kannada audio → server STT → en, hi --------------
    from app.providers.text_to_speech.adapters import SarvamTTS

    audio = await SarvamTTS().synthesize("ಸರಿ, ನಾನು ಐದು ಗಂಟೆಗೆ ಬರುತ್ತೇನೆ.", "kn")
    t0 = time.monotonic()
    r = await c.post(f"/api/rooms/{rid}/utterances/audio", headers=H(b), data={"idempotency_key": uuid.uuid4().hex},
                     files={"audio": ("u.wav", audio.audio, "audio/wav")})
    check("audio upload accepted", r.status_code == 202, f"{r.status_code} {r.text[:120]}")
    u2 = r.json()
    tr = await la.wait_for(lambda e: e["type"] == "utterance.transcribed" and e["utterance_id"] == u2.get("id"))
    en = await la.wait_for(lambda e: e["type"] == "translation.ready" and e["payload"]["target_language"] == "en" and e["utterance_id"] == u2.get("id"))
    hi2 = await lm.wait_for(lambda e: e["type"] == "translation.ready" and e["payload"]["target_language"] == "hi" and e["utterance_id"] == u2.get("id"))
    ms = int((time.monotonic() - t0) * 1000)
    check("server speech recognition (Kannada)", bool(tr) and bool(SCRIPT["kn"].search(tr["payload"].get("original_text") or "")), tr and tr["payload"].get("original_text"))
    check("Asha receives English from speech", bool(en) and bool(SCRIPT["en"].search(en["payload"]["translated_text"] or "")), en and en["payload"]["translated_text"])
    check("Meera receives Hindi from speech", bool(hi2), hi2 and hi2["payload"]["translated_text"])
    check("speech → caption latency", ms < 10000, f"{ms} ms end-to-end")

    # --- Voice playback ---------------------------------------------------------------
    if kn:
        r = await c.get(f"/api/translations/{kn['payload']['id']}/audio", headers=H(b))
        check("translated voice audio", r.status_code == 200 and r.headers["content-type"].startswith("audio/") and len(r.content) > 5000,
              f"{r.status_code} {r.headers.get('content-type')} {len(r.content)} bytes")
        r = await c.get(f"/api/translations/{kn['payload']['id']}/audio")
        check("voice requires membership", r.status_code == 401)

    # --- Glossary, feedback, repeat ------------------------------------------------------
    g = await c.post(f"/api/rooms/{rid}/glossary", headers=H(a), json={"source_term": "BRIDGE"})
    check("owner adds glossary term", g.status_code == 201 and g.json()["status"] == "approved")
    u3 = (await c.post(f"/api/rooms/{rid}/utterances", headers=H(a),
                       json={"idempotency_key": uuid.uuid4().hex, "text": "Welcome to the BRIDGE demo.", "input_mode": "text"})).json()
    kn3 = await lb.wait_for(lambda e: e["type"] == "translation.ready" and e["utterance_id"] == u3["id"] and e["payload"]["target_language"] == "kn")
    check("glossary applied", bool(kn3) and "BRIDGE" in (kn3["payload"]["translated_text"] or ""), kn3 and kn3["payload"]["translated_text"])
    if kn:
        f = await c.post(f"/api/translations/{kn['payload']['id']}/feedback", headers=H(b), json={"feedback_type": "incorrect", "suggested_text": "test"})
        note = await la.wait_for(lambda e: e["type"] == "translation.feedback", 5)
        check("feedback reaches speaker", f.status_code == 201 and bool(note))
    r = await c.post(f"/api/rooms/{rid}/utterances/{u2['id']}/repeat", headers=H(a))
    check("ask to repeat", r.status_code == 201)

    # --- Access control ------------------------------------------------------------------------
    other = (await c.post("/api/rooms", json={**base, "display_name": "X", "preferred_language": "en"})).json()
    r = await c.get(f"/api/rooms/{rid}/transcript", headers=H(other))
    check("other room's token rejected", r.status_code == 403)
    t = (await c.get(f"/api/rooms/{rid}/transcript", headers=H(m))).json()
    check("transcript has all messages", len(t["utterances"]) == 3, str(len(t["utterances"])))

    # --- End room (ephemeral → purged) ------------------------------------------------------------
    r = await c.post(f"/api/rooms/{rid}/end", headers=H(a))
    ended = await lb.wait_for(lambda e: e["type"] == "room.ended", 5)
    check("room ended for everyone", r.status_code == 200 and bool(ended))
    await asyncio.sleep(1)
    t = (await c.get(f"/api/rooms/{rid}/transcript", headers=H(a))).json()
    check("ephemeral transcript deleted", t["utterances"] == [])
    r = await c.post("/api/rooms/join", json={**base, "join_code": code, "display_name": "Late", "preferred_language": "en"})
    check("cannot join ended room", r.status_code == 410)
    await c.post(f"/api/rooms/{other['room']['id']}/end", headers=H(other))

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed" + (f"; FAILED: {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
