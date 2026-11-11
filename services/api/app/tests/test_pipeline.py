from __future__ import annotations

import uuid

from app.core.config import get_settings
from app.providers.translation.adapters import MockTranslation
from app.tests.conftest import auth, create_room, join_room, say, wait_done


def _room_with(client, *langs):
    owner = create_room(client)
    guests = [join_room(client, owner["room"]["join_code"], f"P{i}", lang) for i, lang in enumerate(langs)]
    return owner, guests


def test_translates_once_per_distinct_target_language(client):
    owner, _ = _room_with(client, "kn", "kn", "hi", "en")
    u = say(client, owner, "Where shall we meet?").json()
    assert u["processing_status"] == "processing"
    done = wait_done(client, owner, u["id"])
    assert done["processing_status"] == "complete"
    targets = sorted(t["target_language"] for t in done["translations"])
    assert targets == ["hi", "kn"]  # en listeners read the original; kn translated once
    assert MockTranslation.calls == 2
    kn = next(t for t in done["translations"] if t["target_language"] == "kn")
    assert kn["translated_text"] == "[kn] Where shall we meet?"
    assert kn["quality_status"] == "translated"
    assert done["original_text"] == "Where shall we meet?"
    assert done["speaker_name"] == "Asha"


def test_translation_cache(client):
    owner, _ = _room_with(client, "kn")
    for _ in range(3):
        wait_done(client, owner, say(client, owner, "same words").json()["id"])
    assert MockTranslation.calls == 1


def test_duplicate_submission_is_idempotent(client):
    owner, _ = _room_with(client, "kn")
    key = uuid.uuid4().hex
    first = say(client, owner, "hello", key=key).json()
    second = say(client, owner, "hello", key=key).json()
    assert first["id"] == second["id"]
    wait_done(client, owner, first["id"])
    utterances = client.get(f"/api/rooms/{owner['room']['id']}/transcript", headers=auth(owner)).json()["utterances"]
    assert len(utterances) == 1


def test_sequence_numbers_increase(client):
    owner, (g,) = _room_with(client, "kn")
    ids = [say(client, owner, "one").json(), say(client, g, "two").json(), say(client, owner, "three").json()]
    assert [u["sequence_number"] for u in ids] == [1, 2, 3]


def test_partial_translation_failure_keeps_room_working(client):
    owner, _ = _room_with(client, "kn", "hi")
    u = say(client, owner, "please FAIL:hi now").json()
    done = wait_done(client, owner, u["id"])
    assert done["processing_status"] == "partial"
    by_lang = {t["target_language"]: t for t in done["translations"]}
    assert by_lang["hi"]["quality_status"] == "failed"
    assert by_lang["hi"]["translated_text"] is None
    assert by_lang["kn"]["quality_status"] == "translated"
    assert done["original_text"] == "please FAIL:hi now"

    # Retrying a still-failing language replaces the failed row rather than duplicating it.
    r = client.post(f"/api/rooms/{owner['room']['id']}/utterances/{u['id']}/translations",
                    params={"target_language": "hi"}, headers=auth(owner))
    assert r.status_code == 200 and r.json()["quality_status"] == "failed"
    again = client.get(f"/api/rooms/{owner['room']['id']}/transcript", headers=auth(owner)).json()["utterances"][0]
    assert sorted(t["target_language"] for t in again["translations"]) == ["hi", "kn"]


def test_on_demand_translation_after_language_change(client):
    owner, (g,) = _room_with(client, "kn")
    u = say(client, owner, "good morning").json()
    wait_done(client, owner, u["id"])
    client.patch(f"/api/rooms/{owner['room']['id']}/participants/me", headers=auth(g), json={"preferred_language": "te"})
    r = client.post(f"/api/rooms/{owner['room']['id']}/utterances/{u['id']}/translations",
                    params={"target_language": "te"}, headers=auth(g))
    assert r.status_code == 200, r.text
    assert r.json()["translated_text"] == "[te] good morning"


def test_same_language_listeners_get_no_translation(client):
    owner, _ = _room_with(client, "en")
    done = wait_done(client, owner, say(client, owner, "hi all").json()["id"])
    assert done["translations"] == [] and done["processing_status"] == "complete"


def test_audio_utterance_with_server_stt(client):
    owner, _ = _room_with(client, "kn")
    r = client.post(
        f"/api/rooms/{owner['room']['id']}/utterances/audio",
        headers=auth(owner),
        data={"idempotency_key": uuid.uuid4().hex},
        files={"audio": ("u.wav", b"MOCK|spoken words", "text/plain")},
    )
    assert r.status_code == 202, r.text
    done = wait_done(client, owner, r.json()["id"])
    assert done["original_text"] == "spoken words"
    assert done["stt_provider"] == "mock"
    assert done["translations"][0]["translated_text"] == "[kn] spoken words"


def test_stt_failure_reported(client):
    owner, _ = _room_with(client, "kn")
    r = client.post(
        f"/api/rooms/{owner['room']['id']}/utterances/audio",
        headers=auth(owner),
        data={"idempotency_key": uuid.uuid4().hex},
        files={"audio": ("u.wav", b"FAIL", "text/plain")},
    )
    done = wait_done(client, owner, r.json()["id"])
    assert done["processing_status"] == "failed"
    assert done["error_code"] == "provider_unavailable"


def test_audio_rejects_non_wav(client):
    owner, _ = _room_with(client, "kn")
    r = client.post(
        f"/api/rooms/{owner['room']['id']}/utterances/audio",
        headers=auth(owner),
        data={"idempotency_key": uuid.uuid4().hex},
        files={"audio": ("u.webm", b"\x1aE\xdf\xa3notwav", "audio/webm")},
    )
    assert r.status_code == 415


def test_text_length_limit(client):
    owner, _ = _room_with(client, "kn")
    r = say(client, owner, "x" * (get_settings().max_text_chars + 1))
    assert r.status_code == 413


def test_glossary_applied_and_reported(client):
    owner, (g,) = _room_with(client, "kn")
    rid = owner["room"]["id"]
    r = client.post(f"/api/rooms/{rid}/glossary", headers=auth(owner),
                    json={"source_term": "BRIDGE", "preferred_translation": "BRIDGE"})
    assert r.json()["status"] == "approved"
    sug = client.post(f"/api/rooms/{rid}/glossary", headers=auth(g), json={"source_term": "Jayanagar"}).json()
    assert sug["status"] == "suggested"
    done = wait_done(client, owner, say(client, owner, "Welcome to bridge everyone").json()["id"])
    kn = done["translations"][0]
    assert kn["glossary_terms"] == ["BRIDGE"]
    assert kn["translated_text"] == "[kn] Welcome to BRIDGE everyone"
    assert client.post(f"/api/rooms/{rid}/glossary/{sug['id']}/approve", headers=auth(g)).status_code == 403
    assert client.post(f"/api/rooms/{rid}/glossary/{sug['id']}/approve", headers=auth(owner)).json()["status"] == "approved"


def test_feedback_and_repeat_request(client):
    owner, (g,) = _room_with(client, "kn")
    done = wait_done(client, owner, say(client, owner, "hello").json()["id"])
    tid = done["translations"][0]["id"]
    r = client.post(f"/api/translations/{tid}/feedback", headers=auth(g),
                    json={"feedback_type": "incorrect", "suggested_text": "ನಮಸ್ಕಾರ"})
    assert r.status_code == 201 and r.json()["suggested_text"] == "ನಮಸ್ಕಾರ"
    other = create_room(client, display_name="Stranger")
    assert client.post(f"/api/translations/{tid}/feedback", headers=auth(other),
                       json={"feedback_type": "helpful"}).status_code == 403
    r = client.post(f"/api/rooms/{owner['room']['id']}/utterances/{done['id']}/repeat", headers=auth(g))
    assert r.status_code == 201


def test_tts_on_demand(client):
    owner, (g,) = _room_with(client, "kn")
    done = wait_done(client, owner, say(client, owner, "hello").json()["id"])
    tid = done["translations"][0]["id"]
    r = client.get(f"/api/translations/{tid}/audio", headers=auth(g))
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    client.patch(f"/api/rooms/{owner['room']['id']}", headers=auth(owner), json={"voice_playback_enabled": False})
    assert client.get(f"/api/translations/{tid}/audio", headers=auth(g)).status_code == 403


def test_summary(client):
    owner = create_room(client, summaries_enabled=True)
    join_room(client, owner["room"]["join_code"], "R", "kn")
    wait_done(client, owner, say(client, owner, "We agreed to meet Friday").json()["id"])
    r = client.post(f"/api/rooms/{owner['room']['id']}/summary", headers=auth(owner), json={"language": "en"})
    assert r.status_code == 201
    assert r.json()["model_provider"] == "mock"

    off = create_room(client, display_name="B")
    assert client.post(f"/api/rooms/{off['room']['id']}/summary", headers=auth(off),
                       json={"language": "en"}).status_code == 403
