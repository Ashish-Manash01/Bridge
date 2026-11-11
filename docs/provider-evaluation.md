# Provider evaluation, tested languages & known limitations

## Verified with Sarvam AI (2026-11-12)

With `STT_PROVIDER=sarvam`, `TRANSLATION_PROVIDER=sarvam` (mayura, `formal` mode), `TTS_PROVIDER=sarvam` (bulbul:v3):

| Check | Result |
|---|---|
| `scripts/evaluate_providers.py`, all 6 languages | ✅ `automated_pass` (translation both ways, code-switched input, voice synthesis, and recognition of that voice) |
| Speech recognition of synthesized speech | similarity 0.94–1.00 in en/hi/kn/ta/te/ml, ~0.2 s per utterance |
| `scripts/smoke_live.py` (3 people over real WebSockets) | ✅ 44/44: typed en→kn/hi in 1.9 s, spoken Kannada→en/hi in 1.6 s end to end, voice playback, glossary, feedback, room end + purge |

Notes: `mayura:v1` in `modern-colloquial` mode mixes English words in Latin script ("Library-ಯಲ್ಲಿ five o'clock-ಗೆ meet…"); BRIDGE defaults to `formal` (native script throughout; numbers may be written as words). `bulbul:v2` is retired. Use `bulbul:v3` (voices: priya, kavya, rahul…; empty = default). These are automated checks, not human review: native speakers should still rate real conversations before public launch.

## Free configuration (no API keys)

| Capability | Provider | Notes |
|---|---|---|
| Speech-to-text | Browser Web Speech API | Chrome (Android/desktop), Safari (iOS ≥ 14.5), Edge. **Not Firefox.** One language per utterance (the participant's "I usually speak"). |
| Translation | MyMemory | Free; ~5,000 chars/day per server IP (50,000 with `MYMEMORY_CONTACT_EMAIL`). Fine for pilots, **not production scale**. |
| Text-to-speech | Device voices | Availability depends on the device: Android usually has Hindi/Tamil/Telugu/Kannada/Malayalam voices; desktop Windows/macOS often lack some. The UI checks and falls back to captions. |

## Automated results (2026-11-11, MyMemory)

`python -m scripts.evaluate_providers` translated a fixed set (meeting logistics, names, numbers, place names, code-switched sentences) to and from English:

| Language | en → lang (3 cases) | lang → en | Code-switched → en | Speech |
|---|---|---|---|---|
| Hindi | ✅ names & numbers kept | ✅ | ✅ "कल meeting है, please slides ready रखना" → "There is a meeting tomorrow, please keep the slides ready." | device, needs manual testing |
| Kannada | ✅ | ✅ | ✅ "ನಾಳೆ meeting ಇದೆ…" → "There's a meeting tomorrow. Get the slides ready." | device |
| Tamil | ✅ | ✅ | – | device |
| Telugu | ✅ (≈2 s latency) | ✅ | – | device |
| Malayalam | ✅ | ✅ | – | device |
| English | source | – | – | device |

Typical translation latency was 0.8–2.1 s per language. Because speech runs on the participant's device, **no language is marked "Automated check passed" or "Human-reviewed"** in the app yet; the languages page shows "Translation auto-check passed; speech runs on the participant's device and needs manual testing."

Live two-way checks through the full API (typed input): English ↔ Kannada ↔ Hindi delivered correct per-recipient translations (e.g. "ಸರಿ, ನಾನು ಐದು ಗಂಟೆಗೆ ಬರುತ್ತೇನೆ." → "Okay, I'll be back at five o'clock." Note "be back" vs "come": an example of why the original is always shown and feedback exists).

## Recommended production providers

| Need | Recommendation | Why |
|---|---|---|
| Indic STT + translation + TTS | **Sarvam AI** (`saarika`, `mayura`/`sarvam-translate`, `bulbul`) | Built for Indian languages, handles code-mixed speech, one key for all three. Works in every browser (server STT). |
| Broad coverage / enterprise | Google Cloud Speech, Translation, TTS | Mature, all launch languages; glossary via BRIDGE placeholder strategy. |
| Context/glossary-aware translation | Anthropic or OpenAI (LLM) | Uses room glossary + last few turns natively; higher latency/cost. |

Switch with env vars only (`STT_PROVIDER=sarvam`, etc.); no code changes.

## Evaluation protocol before launch (spec §10, §13)

1. Record a real test set per language: different accents and speeds, quiet and moderately noisy rooms, code-switched sentences, names, places, numbers, technical terms, short and long utterances.
2. Run each candidate provider; measure WER (where references exist), end-of-speech → caption latency, end-of-speech → audio latency, failure rate, cost per minute.
3. Have native speakers rate translation **adequacy (meaning)** 1–5, not word overlap.
4. Record results in `app/core/evaluation_results.json` with status `human_reviewed` only after step 3.
5. Compare hands-on with Google Translate conversation mode and Microsoft Translator group conversations on the same scenarios.

## Known limitations

- Browser STT recognises one language per utterance; strongly code-switched speech may be partially misrecognised. Use server STT (Sarvam) for mixed speech.
- Firefox can't do speech input in browser mode (typing works).
- Device TTS voice availability and quality vary; captions are always available.
- MyMemory's free quota can run out; translation then fails visibly (original still shown). Configure a fallback or paid provider.
- No automatic speaker diarization: attribution relies on each person pressing Speak on their own device.
- Not suitable for legal, medical or emergency interpretation. Can't access phone/WhatsApp call audio.
- Server-side Sarvam/Google/OpenAI adapters are implemented against the providers' documented APIs and covered by unit tests with mocked HTTP, but haven't been exercised with live keys yet. Run `scripts/evaluate_providers.py` after adding a key.
