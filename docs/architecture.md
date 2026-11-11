# Architecture

## Overview

```
Phone / laptop browser (Next.js PWA, static export)
   │  REST (JSON, multipart audio)          WebSocket /ws/rooms/{id}?token=
   ▼                                         ▼
FastAPI ───────────────────────────────────────────────────────────────
   api/          routes: rooms, participants, utterances, glossary, feedback, audio, summary
   realtime/     Hub (in-memory fan-out per room) + WebSocket endpoint
   services/     pipeline · rooms (lifecycle, retention sweeper) · usage/quotas · capabilities · caches
   providers/    SpeechToText / Translation / TextToSpeech / Summary interfaces + adapters
   models/ db/   SQLAlchemy (SQLite dev, PostgreSQL prod) · Alembic migrations
```

One deployable service is enough for the first release: the API can also serve the exported web app (`STATIC_DIR`), so HTTPS and WSS share one origin. The web app can also be hosted separately (set `NEXT_PUBLIC_API_URL`).

## Utterance pipeline

1. **Capture**: participant presses Speak (tap-to-toggle or hold-to-talk).
   - *Browser mode* (default): the Web Speech API recognises speech on the device/browser vendor's service; the client posts the text (`input_mode=voice_browser`).
   - *Server mode*: the client records 16 kHz mono WAV through an AudioWorklet (ScriptProcessor fallback). WAV behaves identically on Android, iOS and desktop. It is uploaded with an idempotency key, held in memory only for the provider call, never stored.
2. **Canonical utterance**: persisted with a per-room sequence number (room-level lock) and `(participant, idempotency_key)` uniqueness, so retries and reconnects can never duplicate a message.
3. **STT** (server mode) with timeout; failure → `utterance.failed` with a friendly message.
4. **Targets**: distinct preferred languages of active participants, minus the source language. **One translation per language**, run concurrently.
5. **Translation**: TTL cache keyed by `sha256(provider, text, source, target, glossary_version, context_version)`; optional fallback provider; glossary via native prompt (LLM) or placeholder protection (others); limited context window (last N turns) for context-aware providers.
6. **Delivery**: `utterance.transcribed`, then `translation.ready` / `translation.failed` per language. A failing language never blocks the others; the original is always delivered.
7. **Voice**: synthesised **on demand** when a listener plays a translation (`GET /api/translations/{id}/audio`), cached briefly; or spoken by the device's own voices in browser mode. Each client has a bounded playback queue (max 3, no overlap, stoppable, never autoplays audio older than 30 s).

## Client state

`lib/roomState.ts` is a pure reducer over the event stream. Merges are keyed by utterance id and target language, statuses never regress, a successful translation is never replaced by a late failure. Duplicate, late and out-of-order events converge to the same state. On every (re)connect the client fetches the transcript and merges it ("gap-fill").

## Turn-taking

Pressing Speak sends `floor.request`; others see "Asha is speaking". If someone else already holds the floor, the requester gets `floor.busy` and a "take turns" notice. It's a hint, not a lock: nothing is silently merged or dropped.

## Security

- Guest tokens: HS256 JWT `{participant, room, role, exp}`, 4 h default, refreshed at half-life. Every REST read/write and the WebSocket check that the token's room matches and the participant hasn't left.
- Join codes: 6 characters from a 31-symbol unambiguous alphabet (~887 M combinations) plus per-IP rate limits on join and preview.
- Provider keys exist only in backend env vars. Clients can't supply provider URLs or file paths.
- Logs are structured JSON with ids, sizes, timings and error codes, never message text, names or tokens; uvicorn access logs are disabled because the WebSocket URL carries the token.
- Security headers, `Cache-Control: no-store` on API responses.

## Scaling notes

The hub, rate limiter and caches are **in-process**, which is correct for a single instance (recommended for the pilot). To run several instances: move fan-out to Redis pub/sub, the rate limiter to Redis, and keep rooms sticky or share the hub. The interfaces (`Hub.broadcast`, `RateLimiter.check`, `TTLCache`) are the swap points.
