# BRIDGE

**One room, many languages, one conversation.** People speak naturally in the language they know; everyone else follows in the language they prefer, as captions or voice.

BRIDGE is a mobile-first PWA (Next.js) with a FastAPI backend. A host creates a room and shares a QR code. Guests join in their phone browser with a name and a language. When someone presses **Speak**, BRIDGE transcribes the utterance, translates it **once per language present in the room**, and delivers each person their own translation with the speaker's name and the original one tap away.

> BRIDGE is not a replacement for phone/WhatsApp calls and is not a legal, medical or emergency interpretation service. Machine translation can be wrong; BRIDGE shows uncertainty and always keeps the original.

## What works today

| Area | Status |
|---|---|
| Rooms, QR/link/code joining, guest participation | ✅ |
| Per-participant language and output mode (captions / voice / both) | ✅ |
| Live feed over WebSockets, speaker attribution, sequencing, reconnect + gap-fill | ✅ |
| Speech-to-text | ✅ Browser Web Speech API (no key) · server adapters for Sarvam, Google Cloud, OpenAI |
| Translation | ✅ MyMemory (no key, daily quota) · Sarvam, Google Cloud, OpenAI, Anthropic |
| Text-to-speech | ✅ Device voices (no key) · server adapters for Sarvam, Google Cloud, OpenAI |
| Original text, uncertainty flags, partial-failure handling, retry | ✅ |
| Glossary (owner terms + participant suggestions), translation feedback, ask-to-repeat | ✅ |
| Retention modes (delete on end / 24 h / 7 d), room expiry, history deletion, export | ✅ |
| Rate limits, quotas, usage + estimated cost tracking | ✅ |
| AI summary (optional, consent-gated, labelled) | ✅ with an Anthropic/OpenAI key |
| PWA manifest, icons, offline shell | ✅ |

Tested languages and known limitations: [docs/provider-evaluation.md](docs/provider-evaluation.md).

## Repository layout

```
apps/web/            Next.js 15 PWA (TypeScript, Tailwind v4), static export
  app/               routes: / · /new · /join · /room · /transcript · /languages · /privacy
  components/        UI kit, room screen, brand (voice orb, live demo)
  hooks/ lib/        realtime room state, speech capture, playback queue, API client
  tests/unit         Vitest (state reducer, audio encoding, message card)
  tests/e2e          Playwright (two/three-browser conversation, consent, end room)
services/api/        FastAPI backend
  app/api            REST routes          app/realtime   WebSocket hub + endpoint
  app/providers      STT / translation / TTS adapters behind interfaces
  app/services       pipeline, rooms, usage, capabilities, caches
  app/models         SQLAlchemy models    alembic/       migrations
  app/tests          pytest (51 tests)    scripts/       evaluation, HTTPS dev server, icons
docs/                architecture, API, privacy, provider evaluation, testing, deployment
Dockerfile           single-service image (API + web app + WebSockets)
render.yaml          Render blueprint
```

## Run it locally

Prerequisites: **Python 3.12+**, **Node 20+**.

```bash
# 1. Configure
cp .env.example .env            # defaults work with no API keys

# 2. Backend
cd services/api
python -m venv .venv
.venv/Scripts/activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3. Frontend (new terminal)
cd apps/web
npm install
npm run dev                     # http://localhost:3000  (talks to the API on :8000)
```

Open http://localhost:3000, create a room, then join from a second browser window (or a private window) with a different language.

### Try it on phones (same Wi-Fi)

Phone browsers only allow the microphone on **https** pages, so use the HTTPS dev server:

```bash
cd apps/web && npm run build            # creates apps/web/out
cd ../../services/api && python scripts/dev_https.py
# → prints https://192.168.x.x:8443. Open it on each phone; accept the self-signed certificate warning once.
```

Speech input in the default (browser) mode works in **Chrome on Android/desktop** and **Safari on iOS**. Firefox has no Web Speech recognition; users there can type, or you can enable a server STT provider (Sarvam/Google/OpenAI) which works in every browser.

## Tests

```bash
cd services/api && python -m pytest          # backend: 51 tests (mock providers)
cd apps/web && npm test                      # frontend unit/component: 27 tests
cd apps/web && npm run typecheck && npx eslint .
# end-to-end (needs the stack running; uses the real configured providers):
cd apps/web && E2E_BASE_URL=http://localhost:8000 npm run test:e2e -- --project=desktop
cd services/api && python -m scripts.evaluate_providers   # real-provider language checks
```

See [docs/testing.md](docs/testing.md).

## Deploy

Short version: build the Docker image (it serves everything from one origin), give it a PostgreSQL `DATABASE_URL` and a `SECRET_KEY`, put it behind HTTPS. Step-by-step for Render, Railway, Fly.io and Vercel + separate API: **[docs/deployment.md](docs/deployment.md)**.

## Documentation

- [Architecture](docs/architecture.md): components, pipeline, scaling notes
- [API & realtime events](docs/api.md)
- [Privacy & data handling](docs/privacy.md)
- [Provider evaluation, tested languages & limitations](docs/provider-evaluation.md)
- [Testing](docs/testing.md)
- [Deployment](docs/deployment.md)
