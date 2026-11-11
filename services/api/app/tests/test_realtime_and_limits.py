from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings
from app.tests.conftest import create_room, join_room, say


def _drain_until(ws, type_: str, limit: int = 30) -> dict:
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == type_:
            return msg
    raise AssertionError(f"did not receive {type_}")


def test_ws_rejects_bad_token(client):
    owner = create_room(client)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws/rooms/{owner['room']['id']}?token=nope") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_ws_rejects_other_rooms_token(client):
    a = create_room(client)
    b = create_room(client, display_name="B")
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws/rooms/{a['room']['id']}?token={b['token']}") as ws:
            ws.receive_json()
    assert exc.value.code == 4403


def test_ws_delivers_snapshot_and_translation_events(client):
    owner = create_room(client)
    guest = join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    rid = owner["room"]["id"]
    with client.websocket_connect(f"/ws/rooms/{rid}?token={guest['token']}") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "room.snapshot"
        assert {p["display_name"] for p in snap["payload"]["participants"]} == {"Asha", "Ravi"}
        assert _drain_until(ws, "connection.status")["payload"]["status"] == "connected"

        u = say(client, owner, "See you tomorrow").json()
        transcribed = _drain_until(ws, "utterance.transcribed")
        assert transcribed["utterance_id"] == u["id"]
        assert transcribed["payload"]["original_text"] == "See you tomorrow"
        ready = _drain_until(ws, "translation.ready")
        assert ready["payload"]["target_language"] == "kn"
        assert ready["payload"]["translated_text"] == "[kn] See you tomorrow"
        for key in ("event_id", "room_id", "ts"):
            assert ready[key]


def test_ws_floor_busy_when_two_speak(client):
    owner = create_room(client)
    guest = join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    rid = owner["room"]["id"]
    with client.websocket_connect(f"/ws/rooms/{rid}?token={owner['token']}") as a, \
         client.websocket_connect(f"/ws/rooms/{rid}?token={guest['token']}") as b:
        _drain_until(a, "connection.status")
        _drain_until(b, "connection.status")
        a.send_json({"type": "floor.request"})
        _drain_until(b, "utterance.started")
        b.send_json({"type": "floor.request"})
        busy = _drain_until(b, "floor.busy")
        assert busy["payload"]["speaking"] == [owner["participant"]["id"]]
        b.send_json({"type": "nonsense"})
        assert _drain_until(b, "error")["payload"]["code"] == "invalid_message"


def test_ws_closed_after_leaving(client):
    owner = create_room(client)
    guest = join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    client.post(f"/api/rooms/{owner['room']['id']}/leave", headers={"Authorization": f"Bearer {guest['token']}"})
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws/rooms/{owner['room']['id']}?token={guest['token']}") as ws:
            ws.receive_json()
    assert exc.value.code == 4403


def test_join_rate_limited(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_join_per_minute", 3)
    statuses = [
        client.post("/api/rooms/join", json={"join_code": f"AAAA{i}{i}", "display_name": "x",
                                              "preferred_language": "en", "consent": True}).status_code
        for i in range(2, 7)
    ]
    assert statuses[:3] == [404, 404, 404]
    assert 429 in statuses[3:]


def test_utterance_rate_limited(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_utterance_per_minute", 2)
    owner = create_room(client)
    codes = [say(client, owner, f"m{i}").status_code for i in range(3)]
    assert codes == [202, 202, 429]


def test_per_participant_usage_limit(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_utterances_per_participant", 1)
    owner = create_room(client)
    assert say(client, owner, "one").status_code == 202
    r = say(client, owner, "two")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "participant_quota"


def test_usage_endpoint(client):
    owner = create_room(client)
    join_room(client, owner["room"]["join_code"], "R", "kn")
    say(client, owner, "hello")
    r = client.get(f"/api/rooms/{owner['room']['id']}/usage",
                   headers={"Authorization": f"Bearer {owner['token']}"}).json()
    assert r["utterances_by_me"] == 1


def test_config_exposes_mock_mode_and_matrix(client):
    cfg = client.get("/api/config").json()
    assert cfg["mock_mode"] is True
    codes = [lang["code"] for lang in cfg["languages"]]
    assert codes == ["en", "hi", "kn", "ta", "te", "ml"]
    assert all(lang["tested"] in (None, "automated_pass", "human_reviewed", "failed") for lang in cfg["languages"])
    assert client.get("/api/health").json()["database"] is True
