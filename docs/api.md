# API & realtime events

Interactive OpenAPI docs: `http://localhost:8000/docs`. All room endpoints require `Authorization: Bearer <guest token>` from create/join, and membership of that room. Errors use `{"detail": {"code", "message", "errors?"}}`.

## REST

| Method | Endpoint | Purpose | Notes |
|---|---|---|---|
| GET | `/api/health` | Health + DB check | |
| GET | `/api/config` | Active providers, limits, language matrix | public, no secrets |
| GET | `/api/languages` | Language capability matrix | |
| POST | `/api/rooms` | Create room (+ owner session) | `consent: true` required; rate limited per IP |
| GET | `/api/rooms/preview/{code}` | Pre-join info (name, languages, retention) | rate limited |
| POST | `/api/rooms/join` | Join with code | rate limited per IP |
| POST | `/api/rooms/{id}/token/refresh` | New guest token | |
| GET | `/api/rooms/{id}` | Room details | |
| PATCH | `/api/rooms/{id}` | Update name/topic/voice/retention/languages | owner |
| POST | `/api/rooms/{id}/end` | End room (purges now if ephemeral) | owner |
| POST | `/api/rooms/{id}/leave` | Leave room (token stops working) | |
| DELETE | `/api/rooms/{id}/history?scope=room\|mine` | Delete transcript content | `room` = owner |
| GET | `/api/rooms/{id}/participants` | Active participants + online state | |
| PATCH | `/api/rooms/{id}/participants/me` | Language, spoken language, output mode, mute, name | |
| GET | `/api/rooms/{id}/usage` | Usage vs limits, estimated cost | |
| POST | `/api/rooms/{id}/utterances` | Submit text (typed or browser-recognised) | JSON, idempotency key |
| POST | `/api/rooms/{id}/utterances/audio` | Submit 16-bit mono WAV for server STT | multipart, ≤ 30 s / 2 MB |
| POST | `/api/rooms/{id}/utterances/{uid}/translations?target_language=` | On-demand translate / retry failed | |
| POST | `/api/rooms/{id}/utterances/{uid}/repeat` | Ask speaker to repeat | |
| GET | `/api/rooms/{id}/transcript?after_seq=` | Permitted transcript + retention notice | |
| GET/POST | `/api/rooms/{id}/glossary` | List / add term (owner) or suggestion (others) | |
| POST | `/api/rooms/{id}/glossary/{gid}/approve` | Approve suggestion | owner |
| DELETE | `/api/rooms/{id}/glossary/{gid}` | Remove term | owner |
| POST | `/api/translations/{tid}/feedback` | incorrect / unclear / repeat_request / helpful (+ suggestion, glossary suggestion) | |
| GET | `/api/translations/{tid}/audio` | On-demand TTS audio | 409 in browser-TTS mode |
| GET/POST | `/api/rooms/{id}/summary` | Latest / generate AI summary | room must have summaries enabled |

## WebSocket

`wss://<host>/ws/rooms/{room_id}?token=<guest token>`. Close codes: `4401` bad/expired token, `4403` not a member / left, `4001` room ended.

Every server message is an envelope:

```json
{ "type": "translation.ready", "event_id": "…", "room_id": "…", "ts": "2026-11-11T10:00:00Z",
  "participant_id": "…", "utterance_id": "…", "sequence_number": 7, "payload": { … } }
```

| Event | Payload |
|---|---|
| `room.snapshot` | room, participants (with `online`), `last_sequence`. Sent on connect |
| `connection.status` | `{status: "connected"}` |
| `room.updated` / `room.ended` | room / `{reason, retention_mode, purge_after}` |
| `participant.joined` / `participant.updated` | participant |
| `participant.left` / `participant.presence` | `{display_name}` / `{online}` |
| `utterance.started` / `utterance.stopped` | speaker took / released the floor (`overlap_with`) |
| `utterance.processing` | `{speaker_name, input_mode, created_at}` |
| `utterance.transcribed` | full utterance + `recognition_uncertain`, `stt_latency_ms` |
| `utterance.failed` | `{error_code, message}` |
| `utterance.deleted` | `{scope, participant_id}` |
| `translation.ready` / `translation.failed` | translation (`target_language`, `translated_text`, `quality_status`, `quality_note`, `glossary_terms`, `latency_ms`) |
| `translation.feedback` | feedback + `from_name`, `speaker_participant_id` |
| `playback.started` / `playback.stopped` | listener started/stopped audio |
| `glossary.updated` | `{glossary_version, entry?}` |
| `summary.ready` | summary |
| `floor.busy` | `{speaking: [ids], message}`. Sent only to the requester |
| `error` / `pong` | `{code}` / – |

Client → server messages (validated, max 2 KB): `ping`, `floor.request`, `floor.release`, `playback.started`, `playback.stopped`.
