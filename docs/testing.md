# Testing

## Backend (pytest), 51 tests

```bash
cd services/api && python -m pytest
```

Runs with `BRIDGE_ENV=test` and mock providers (refused outside tests). Covers: room creation/joining, consent, guest token expiry and room scoping, participant language updates, owner-only controls, provider adapter success/failure and HTTP error mapping, translation caching, **one translation per target language**, duplicate submission (idempotency), sequencing, partial translation failure + retry, STT failure, audio validation, glossary protection/fallback/scoping, feedback, on-demand TTS, summaries, WebSocket membership (bad token, other room, left), floor-busy, room expiry, retention purge, history deletion, room full, rate limits, usage limits.

## Frontend unit & component (Vitest), 27 tests

```bash
cd apps/web && npm test
```

Covers the event-stream reducer (idempotent merges, out-of-order and late events, failed→retry, speaking/floor, feedback routing, room end, deletion), WAV encoding/downsampling, microphone error mapping (permission denied, no mic, mic in use), and the message card (translation vs original, expandable original, partial failure + retry, uncertainty in words, replay/stop, captions-only fallback, recognition failure, delivery status).

Static checks: `npm run typecheck`, `npx eslint .`, `npm run build`.

## End-to-end (Playwright)

```bash
# terminal 1: serve API + built web app on one origin
cd apps/web && npm run build
cd ../../services/api && STATIC_DIR=../../apps/web/out uvicorn app.main:app --port 8000
# terminal 2
cd apps/web && E2E_BASE_URL=http://localhost:8000 npm run test:e2e -- --project=desktop
```

`tests/e2e/conversation.spec.ts` uses independent browser contexts and the **real configured providers**:

1. Session A (English) creates a room; B joins in Kannada. A's message arrives in Kannada script for B; B can expand the English original. B replies in Kannada; A receives English. C joins in Hindi and receives Devanagari; A sees per-language delivery status.
2. Ask-to-repeat notifies the speaker.
3. Viewing/joining a room never calls `getUserMedia`.
4. Owner ends an ephemeral room; guests see the ended state and that the transcript was deleted.

Projects: `desktop`, `mobile` (Pixel 7), `firefox`, `iphone` (WebKit).

> **Note from the build machine:** on the Windows PC used to build this, Chromium and Firefox renderers crashed intermittently under memory pressure (~1 GB free RAM). The same happened on tailwindcss.com, so it isn't specific to BRIDGE. If you see `Target crashed`, close other apps and rerun, or run the suite in CI (GitHub Actions `ubuntu-latest`). The same flows were verified through the API directly (see provider-evaluation.md).

## Speech (manual; can't be automated headlessly)

Use two or three real phones on `scripts/dev_https.py` or a deployed URL:

| Check | Android Chrome | iPhone Safari |
|---|---|---|
| Mic permission prompt appears only on first Speak | | |
| Denying permission shows the "type instead" guidance | | |
| Speak → original appears for speaker; translation for others | | |
| Hold-to-talk and tap-to-toggle both work; Stop is immediate | | |
| Voice mode plays translations in order, no overlap; mute stops | | |
| Lock screen / switch app during recording stops capture | | |
| Airplane mode → "Reconnecting…" → messages fill in after reconnect, no duplicates | | |
| Two people pressing Speak together shows "take turns" | | |

## Live end-to-end (real providers)

```bash
# with the API running (and the web app built + STATIC_DIR set)
cd services/api && python -m scripts.smoke_live http://localhost:8000
```

44 checks across REST + WebSockets with three simulated people (English, Kannada, Hindi): static pages, security headers, no secrets in config, typed and spoken (real audio) utterances, per-language delivery and latency, idempotency, voice playback, glossary, feedback, access control, room end and transcript purge. Uses a few seconds of provider credit. Point it at staging, not production.

## Provider evaluation

```bash
cd services/api && python -m scripts.evaluate_providers
```

See [provider-evaluation.md](provider-evaluation.md).
