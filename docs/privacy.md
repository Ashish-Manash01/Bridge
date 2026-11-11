# Privacy & data handling

Privacy is a core product requirement. This describes what the code does today. A user-facing summary lives at `/privacy` in the app. **A full privacy policy reviewed for your jurisdiction (e.g. India's DPDP Act 2023) is required before public launch.**

## Consent

- Creating or joining a room requires ticking an explicit notice that explains microphone use, which external services process speech and text, and the room's transcript retention. The server rejects requests without `consent: true` and records `consented_at` per participant.
- The microphone is requested only when a participant first presses Speak, after a "Before you speak" explanation. Viewing and reading never request it (covered by an e2e test).

## Audio

- Captured only between Speak and stop; capture stops if the tab is hidden. A visible "Microphone on" indicator shows while recording.
- Browser mode: recognition runs in the browser vendor's speech service (Google for Chrome, Apple for Safari). BRIDGE receives text only.
- Server mode: WAV is held in memory for the provider request and **never written to disk or database**.

## Text

| Data | Where | Retention |
|---|---|---|
| Utterances, translations, feedback, glossary, summaries | Database | Per room: deleted when the room ends (`ephemeral`), or 24 h / 7 d after end. Rooms auto-end after `ROOM_TTL_HOURS`. A sweeper runs every minute. |
| Display names | Database | Replaced with "(removed)" when content is purged |
| Translation cache | API memory | ~15 min TTL, hashed keys |
| TTS audio cache | API memory | ~10 min |
| Usage records (counts, provider, estimated cost; no content) | Database | Kept for cost tracking |
| Guest session | Browser localStorage | Until token expiry (4 h) or leaving |

Deletion controls: any participant can delete their own messages; the owner can delete the whole transcript or end the room at any time.

## Access

Only participants of a room (valid, room-scoped guest token; not left) can read its transcript or receive its events. Public URLs contain only a join code, never content.

## Processors

The configured providers receive speech/text to process it: MyMemory (translated.net), Sarvam AI, Google Cloud, OpenAI or Anthropic, depending on `.env`. Review each provider's data-retention terms before production; prefer providers/plans that don't retain or train on your data.

## Logging

Structured logs contain ids, sizes, timings, provider names and error codes. Never transcript text, translations, names, glossary terms or tokens. Uvicorn access logs are disabled (the WebSocket URL carries the token).
