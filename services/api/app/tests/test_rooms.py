from __future__ import annotations

import asyncio
from datetime import timedelta

import jwt

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import Room, Utterance, utcnow
from app.services.rooms import sweep_once
from app.tests.conftest import auth, create_room, join_room, say, wait_done


def test_create_and_join_room(client):
    owner = create_room(client)
    assert owner["participant"]["role"] == "owner"
    code = owner["room"]["join_code"]
    assert len(code) == 6

    preview = client.get(f"/api/rooms/preview/{code.lower()}").json()
    assert preview["status"] == "active"
    assert preview["languages_in_use"] == ["en"]

    guest = join_room(client, code, "Ravi", "kn")
    assert guest["participant"]["role"] == "participant"
    people = client.get(f"/api/rooms/{owner['room']['id']}/participants", headers=auth(owner)).json()
    assert {p["display_name"] for p in people} == {"Asha", "Ravi"}


def test_consent_is_required(client):
    r = client.post("/api/rooms", json={"display_name": "A", "preferred_language": "en", "consent": False})
    assert r.status_code == 422


def test_unknown_code_and_disallowed_language(client):
    owner = create_room(client, allowed_languages=["en", "kn"])
    assert client.post("/api/rooms/join", json={
        "join_code": "ZZZZZZ", "display_name": "X", "preferred_language": "en", "consent": True}).status_code == 404
    r = client.post("/api/rooms/join", json={
        "join_code": owner["room"]["join_code"], "display_name": "X", "preferred_language": "hi", "consent": True})
    assert r.status_code == 422


def test_token_required_and_room_scoped(client):
    a = create_room(client)
    b = create_room(client, display_name="Other")
    rid = a["room"]["id"]
    assert client.get(f"/api/rooms/{rid}").status_code == 401
    assert client.get(f"/api/rooms/{rid}", headers=auth(b)).status_code == 403
    assert client.get(f"/api/rooms/{rid}", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_expired_token_rejected(client):
    a = create_room(client)
    expired = jwt.encode(
        {"sub": a["participant"]["id"], "room": a["room"]["id"], "role": "owner", "typ": "guest",
         "exp": utcnow() - timedelta(minutes=1)},
        get_settings().secret_key, algorithm="HS256",
    )
    r = client.get(f"/api/rooms/{a['room']['id']}", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "token_expired"


def test_participant_language_update(client):
    owner = create_room(client, allowed_languages=["en", "kn", "hi"])
    rid = owner["room"]["id"]
    r = client.patch(f"/api/rooms/{rid}/participants/me", headers=auth(owner),
                     json={"preferred_language": "hi", "output_mode": "both"})
    assert r.status_code == 200
    assert r.json()["preferred_language"] == "hi" and r.json()["output_mode"] == "both"
    r = client.patch(f"/api/rooms/{rid}/participants/me", headers=auth(owner), json={"preferred_language": "ta"})
    assert r.status_code == 422


def test_owner_only_controls(client):
    owner = create_room(client)
    guest = join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    rid = owner["room"]["id"]
    assert client.post(f"/api/rooms/{rid}/end", headers=auth(guest)).status_code == 403
    assert client.patch(f"/api/rooms/{rid}", headers=auth(guest), json={"name": "x"}).status_code == 403
    assert client.delete(f"/api/rooms/{rid}/history", headers=auth(guest)).status_code == 403


def test_end_ephemeral_room_purges_content(client):
    owner = create_room(client)
    join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    u = say(client, owner, "hello").json()
    wait_done(client, owner, u["id"])
    rid = owner["room"]["id"]
    r = client.post(f"/api/rooms/{rid}/end", headers=auth(owner))
    assert r.json()["status"] == "ended"
    assert client.get(f"/api/rooms/{rid}/transcript", headers=auth(owner)).json()["utterances"] == []
    # Joining an ended room fails clearly.
    r = client.post("/api/rooms/join", json={"join_code": owner["room"]["join_code"], "display_name": "Late",
                                              "preferred_language": "en", "consent": True})
    assert r.status_code == 410


def test_retained_room_kept_until_purge_window(client):
    owner = create_room(client, transcript_retention_mode="retain_24h")
    join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    u = say(client, owner, "hello").json()
    wait_done(client, owner, u["id"])
    rid = owner["room"]["id"]
    client.post(f"/api/rooms/{rid}/end", headers=auth(owner))
    assert len(client.get(f"/api/rooms/{rid}/transcript", headers=auth(owner)).json()["utterances"]) == 1

    async def age_and_sweep():
        async with SessionLocal() as db:
            room = await db.get(Room, rid)
            room.purge_after = utcnow() - timedelta(seconds=1)
            await db.commit()
            await sweep_once(db)
            return (await db.get(Room, rid)).name

    assert asyncio.run(age_and_sweep()) == "Ended conversation"
    assert client.get(f"/api/rooms/{rid}/transcript", headers=auth(owner)).json()["utterances"] == []


def test_room_expiry(client):
    owner = create_room(client)
    rid = owner["room"]["id"]

    async def expire():
        async with SessionLocal() as db:
            room = await db.get(Room, rid)
            room.expires_at = utcnow() - timedelta(minutes=1)
            await db.commit()
            ended, _ = await sweep_once(db)
            return ended

    assert asyncio.run(expire()) == 1
    assert client.get(f"/api/rooms/{rid}", headers=auth(owner)).json()["status"] == "ended"
    assert say(client, owner, "too late").status_code == 410


def test_delete_my_history_only(client):
    owner = create_room(client, transcript_retention_mode="retain_7d")
    guest = join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    a = say(client, owner, "from owner").json()
    b = say(client, guest, "from guest").json()
    wait_done(client, owner, a["id"])
    wait_done(client, owner, b["id"])
    rid = owner["room"]["id"]
    assert client.delete(f"/api/rooms/{rid}/history?scope=mine", headers=auth(guest)).json() == {"deleted_utterances": 1}
    left = client.get(f"/api/rooms/{rid}/transcript", headers=auth(owner)).json()["utterances"]
    assert [u["original_text"] for u in left] == ["from owner"]

    async def count():
        async with SessionLocal() as db:
            from sqlalchemy import func, select
            return (await db.execute(select(func.count()).select_from(Utterance))).scalar_one()

    assert asyncio.run(count()) == 1


def test_leave_room(client):
    owner = create_room(client)
    guest = join_room(client, owner["room"]["join_code"], "Ravi", "kn")
    rid = owner["room"]["id"]
    assert client.post(f"/api/rooms/{rid}/leave", headers=auth(guest)).status_code == 204
    assert client.get(f"/api/rooms/{rid}", headers=auth(guest)).status_code == 403
    assert len(client.get(f"/api/rooms/{rid}/participants", headers=auth(owner)).json()) == 1


def test_room_full(client, monkeypatch):
    owner = create_room(client)
    monkeypatch.setattr(get_settings(), "max_participants_per_room", 2)

    async def shrink():
        async with SessionLocal() as db:
            room = await db.get(Room, owner["room"]["id"])
            room.max_participants = 2
            await db.commit()

    asyncio.run(shrink())
    join_room(client, owner["room"]["join_code"], "B", "kn")
    r = client.post("/api/rooms/join", json={"join_code": owner["room"]["join_code"], "display_name": "C",
                                              "preferred_language": "en", "consent": True})
    assert r.status_code == 409
