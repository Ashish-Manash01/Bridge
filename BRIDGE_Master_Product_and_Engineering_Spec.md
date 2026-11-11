# BRIDGE --- Product & Engineering Master Specification

## Implementation brief for Claude Code

> **Product promise:** People speak naturally in the language they know.
> Everyone else follows the conversation in the language they prefer.
>
> **Product category:** A multilingual, multi-person conversation layer
> for in-person and hosted online conversations.
>
> **Important positioning:** BRIDGE is not a claim to have invented
> machine translation. Translation, live captions, and group translation
> already exist in competing products. BRIDGE must earn its place
> through a much better *group conversation experience*:
> personal-language output for every participant, low-friction joining,
> context-aware terminology, clear speaker attribution, conversational
> turn handling, and a useful shared conversation record.

------------------------------------------------------------------------

# 1. Instructions to Claude Code

Build BRIDGE as a production-minded, mobile-first web application (PWA)
with a clean architecture and a working end-to-end speech pipeline.

Do not build a static mockup and do not substitute fake translations for
real functionality. Start by inspecting the repository, identifying its
existing stack and conventions, and reporting the proposed
implementation plan. Then implement the product in coherent, tested
increments.

## Non-negotiable engineering rules

1.  The application must work in modern Android and iOS browsers, as
    well as desktop browsers, subject to browser microphone and audio
    restrictions.
2.  Do not assume every device supports the same audio APIs, codecs,
    sample rates, background behavior, or simultaneous microphone and
    playback behavior.
3.  Do not attempt to intercept cellular, WhatsApp, FaceTime, or other
    apps' private call audio. Ordinary web apps cannot reliably access
    that audio. BRIDGE's first-class use case is a conversation room
    where participants join BRIDGE directly.
4.  Use real speech recognition, translation, and speech synthesis
    providers. Keep providers replaceable behind interfaces.
5.  Never expose provider API keys in frontend code. All secret-bearing
    calls go through the backend.
6.  Never claim a translation is perfect. Display uncertainty and offer
    original speech/text when available.
7.  Do not silently store raw audio. Make recording/transcription
    retention explicit and configurable.
8.  Make the app usable if speech playback fails: translated text and
    original text remain available.
9.  Do not fabricate product metrics, verification badges, language
    support, or quality scores.
10. Do not hardcode one vendor into business logic. Implement provider
    adapters and configuration.
11. Include setup instructions, `.env.example`, database migrations,
    tests, error handling, and deployment documentation.
12. Ask before destructive repository changes. Preserve existing user
    work.

------------------------------------------------------------------------

# 2. Product vision

BRIDGE is a shared conversation room where each participant chooses a
preferred language. A participant speaks naturally; BRIDGE transcribes
the utterance, identifies the speaker, translates it into the other
participants' selected languages, and delivers captions and optional
synthesized speech.

The central experience is **one room, many languages, one
conversation**.

## Primary use cases

-   Friends or families who speak different languages.
-   College group discussions and student teams.
-   Multilingual classrooms, workshops, and community events.
-   Small businesses speaking with customers or suppliers.
-   Visitors and hosts communicating in person.
-   Small remote meetings where participants join the BRIDGE room in a
    browser.

## What BRIDGE is not in its first release

-   It is not a replacement for cellular or third-party app calls.
-   It does not secretly listen in the background.
-   It is not a general-purpose translation dictionary.
-   It is not a legal, medical, or emergency interpretation service.
-   It does not promise simultaneous, zero-latency interpretation.
-   It is not an autonomous meeting bot that records everyone without
    consent.

------------------------------------------------------------------------

# 3. Differentiation: what must make BRIDGE worth choosing

A list of features is not a moat. The product must deliver a coherent
experience competitors do not deliver as well for the target audience.
Validate this against current competitors before launch.

## 3.1 Personal-language conversation feed

Every participant sees the same conversation, but each participant's
feed is translated into their own selected language.

Example: - A speaks Kannada. - B speaks Hindi. - C speaks English. - D
speaks Tamil.

Each participant sees: - The speaker's name. - The original utterance
and detected language (expandable). - A translation in their own
selected language. - A clear status: processing, translated, uncertain,
or failed.

Do not create four separate conversations. Maintain one canonical event
stream with per-recipient translations.

## 3.2 Speaker-aware conversation

Attribute each utterance to the participant who submitted it. In the
first version, the speaker taps or holds a clear **Speak** control, so
attribution is reliable.

Do not claim robust automatic speaker diarization from one shared phone
microphone in a noisy room. It is a later capability and requires
careful testing.

## 3.3 Context-aware terminology

Room owners can add a small glossary: - People's names. - Company and
product names. - Course or subject terms. - Technical vocabulary. -
Local place names. - Preferred translations.

Use glossary terms as translation hints where the provider supports
them. Otherwise apply a carefully tested post-processing strategy. Never
silently replace meaning based on a glossary.

## 3.4 Conversation controls, not just translation

Each participant can: - Choose a preferred language. - Choose captions
only, audio only, or captions plus audio. - Replay a translated
utterance. - View the original text. - Mark a translation as
incorrect. - Ask the speaker to repeat. - Mute translated audio without
leaving the room.

Room owners can: - Set room name and supported languages. - Enable or
disable voice playback. - Add glossary terms. - End the room. - Choose
whether a transcript is retained.

## 3.5 Useful conversation outcome

With explicit room consent, BRIDGE can create: - A searchable
transcript. - A concise summary. - Decisions and action items. - A list
of unresolved questions.

This is an optional enhancement, not the core reason to use the app.
Clearly label AI-generated summaries and allow participants to inspect
the underlying transcript.

## 3.6 Low-friction participation

-   Room owner creates a room.
-   BRIDGE creates a short join code and QR code.
-   Participants join through a link in a mobile browser.
-   Guest participants can enter a display name and language without
    creating an account.
-   Account creation is only needed for persistent profiles, saved
    preferences, or room history.
-   Show a clear consent and microphone-permission explanation before
    capture starts.

------------------------------------------------------------------------

# 4. Core user journeys

## 4.1 Create a room

1.  User opens BRIDGE.
2.  Selects **Create conversation**.
3.  Enters an optional room name.
4.  Chooses their language.
5.  Chooses output mode: captions, translated voice, or both.
6.  Creates the room.
7.  Receives a QR code, share link, and join code.
8.  Sees the participant lobby and language list.

## 4.2 Join a room

1.  Participant opens a shared link or scans QR.
2.  Enters a display name.
3.  Selects preferred language.
4.  Selects output mode.
5.  Reads the microphone and privacy explanation.
6.  Grants microphone permission when ready to speak.
7.  Joins the room.

Do not request microphone permission merely to view the room or read the
transcript.

## 4.3 Speak and translate

1.  Participant presses **Speak**.
2.  UI visibly indicates microphone capture.
3.  Audio is captured only for that utterance or explicitly enabled
    speaking session.
4.  Audio is sent securely to the speech provider through the backend or
    an appropriately secured streaming connection.
5.  Speech recognition returns source text and, where supported,
    language identification.
6.  Translation service creates target-language translations for the
    other participants' preferences.
7.  The canonical utterance event is broadcast to the room.
8.  Each participant sees their own translation and can inspect the
    original.
9.  Optional text-to-speech plays the translation in the participant's
    selected voice.
10. The speaker can correct or retry if recognition was wrong.

## 4.4 Handle a misunderstanding

-   Participant taps **Translation seems wrong**.
-   The app displays the original transcript and translation.
-   Participant can suggest a correction or request repetition.
-   Corrections are attached to the utterance, not silently substituted.
-   A room glossary suggestion can be submitted to the owner.

## 4.5 End room and history

-   Room owner ends the room.
-   If transcript retention is enabled, show where it will be saved and
    who can access it.
-   If retention is disabled, delete transient room content according to
    the configured retention policy.
-   Users can export or delete their permitted conversation history.

------------------------------------------------------------------------

# 5. UX and visual design requirements

The design should feel like a polished communication product, not a
developer dashboard.

## Brand personality

-   Calm, modern, confident, welcoming.
-   High legibility and strong accessibility.
-   Avoid excessive neon, clutter, decorative gradients, and gimmicky
    animations.
-   Use subtle visual feedback for speaking, translating, and playback.

## Required screens

1.  Landing / product introduction.
2.  Create room.
3.  Join room.
4.  Participant lobby.
5.  Live conversation.
6.  Language and audio preferences.
7.  Room glossary.
8.  Transcript/history.
9.  Privacy and consent controls.
10. Error, reconnecting, and unsupported-device states.

## Live conversation screen

Must include: - Room title and connection status. - Participant list
with each participant's chosen language. - Prominent Speak button. -
Clear listening/processing indicator. - Conversation feed with speaker
labels. - Original/translation toggle or expandable original. - Replay
translation control. - Output mode selector. - Mute translated audio
control. - Leave room control.

## Accessibility

-   Large touch targets.
-   Captions always available as an alternative to audio.
-   Strong text contrast.
-   Screen-reader labels.
-   Keyboard support on desktop.
-   Do not rely on color alone to communicate status.
-   Respect reduced-motion preferences.
-   Provide a text-only fallback if audio playback is unavailable.

------------------------------------------------------------------------

# 6. Language strategy

Do not advertise a language as supported until it has been tested
end-to-end across speech recognition, translation, and speech synthesis.

## Initial language candidates

Prioritise testing: - English - Hindi - Kannada - Tamil - Telugu -
Malayalam

Potential later additions: - Bengali - Marathi - Gujarati - Punjabi -
Urdu - Spanish - French - German - Arabic

## Language support matrix

Maintain a backend-configured capability matrix for each language and
provider:

  Capability           Meaning
  -------------------- -------------------------------------------------
  Speech input         Provider can transcribe speech in this language
  Language detection   Provider can identify this language reliably
  Translation          Provider can translate to/from this language
  Speech output        Provider can synthesize understandable speech
  Streaming            Provider supports streaming input/output
  Tested               BRIDGE has passed its own evaluation set

The UI must use this matrix. Do not show unavailable combinations as
supported.

## Code-switching

Indian speakers often mix languages within one sentence. Treat
code-switching as a key evaluation scenario.

-   Preserve names and technical terms where appropriate.
-   Do not force every utterance into a single language if the provider
    supports mixed-language recognition.
-   If the recogniser cannot handle mixed speech, allow the participant
    to choose a primary spoken language.
-   Display uncertain recognition rather than pretending certainty.

------------------------------------------------------------------------

# 7. Speech and translation architecture

Use provider-independent interfaces so providers can be changed without
rewriting room logic.

## Required backend interfaces

Define interfaces equivalent to:

``` python
class SpeechToTextProvider:
    async def transcribe(self, audio, source_language=None): ...

class TranslationProvider:
    async def translate(
        self,
        text,
        source_language,
        target_language,
        glossary=None,
        context=None
    ): ...

class TextToSpeechProvider:
    async def synthesize(self, text, language, voice=None): ...
```

For streaming providers, define separate streaming interfaces rather
than forcing streaming into a one-shot method.

## Audio pipeline

``` text
Participant browser
    |
    | explicit microphone permission
    v
Audio capture / utterance buffer
    |
    | secure upload or provider-approved streaming
    v
Backend speech gateway
    |
    v
Speech-to-text provider
    |
    v
Canonical utterance event
    |
    +------> Translation service (one target per distinct participant language)
    |                   |
    |                   v
    |             Translation cache
    |                   |
    v                   v
Room event service <----+
    |
    +------> Participant A feed (language A)
    +------> Participant B feed (language B)
    +------> Participant C feed (language C)
    |
    +------> Optional TTS jobs and audio delivery
```

## Important optimisation

Do not translate the same utterance separately for every participant if
multiple participants share the same target language.

-   Group participants by target language.
-   Translate once per distinct target language.
-   Cache by source text, source language, target language, glossary
    version, and relevant context version.
-   Avoid caching sensitive content longer than necessary.
-   Keep the original utterance as the canonical source.

## Translation context

Provide a limited context window: - Recent conversation turns. - Room
glossary. - Speaker and participant language preferences. - Domain or
room topic, if supplied.

Do not send the entire historical transcript on every request. Limit
context to what is necessary and configurable.

## Text-to-speech strategy

-   Make translated audio opt-in per participant.
-   Default to captions first, with audio available.
-   Prevent overlapping TTS playback by using a per-participant playback
    queue.
-   Allow replay and stop.
-   Provide voice selection only where the provider supports it.
-   Do not promise that every device can play audio while another app or
    phone call is active.

------------------------------------------------------------------------

# 8. Recommended application architecture

## Frontend

-   Next.js with TypeScript.
-   Tailwind CSS.
-   A small, accessible component system.
-   PWA manifest and install guidance.
-   Browser feature detection for microphone, audio playback, and
    supported codecs.
-   WebSocket client with reconnect handling.
-   Client-side state management kept simple and predictable.

## Backend

-   FastAPI.
-   WebSockets for room events.
-   REST endpoints for room lifecycle, preferences, glossary, and
    history.
-   Provider adapter layer for speech, translation, and TTS.
-   Background job processing for non-urgent summary and history tasks.
-   Rate limiting and abuse controls.

## Database

PostgreSQL, preferably managed through Supabase.

Suggested tables:

### users

-   id
-   display_name
-   email (nullable for guest users)
-   preferred_language
-   created_at
-   updated_at

### rooms

-   id
-   join_code
-   owner_user_id (nullable for guest-created rooms)
-   name
-   status
-   default_source_language (optional)
-   transcript_retention_mode
-   created_at
-   expires_at
-   ended_at

### room_participants

-   id
-   room_id
-   user_id (nullable for guest)
-   display_name
-   preferred_language
-   output_mode
-   role
-   joined_at
-   last_seen_at
-   left_at

### utterances

-   id
-   room_id
-   participant_id
-   source_language
-   original_text
-   recognition_confidence (nullable)
-   processing_status
-   created_at
-   sequence_number

### translations

-   id
-   utterance_id
-   target_language
-   translated_text
-   provider
-   quality_status
-   created_at

### room_glossary

-   id
-   room_id
-   source_term
-   preferred_translation
-   source_language
-   target_language
-   created_by
-   created_at

### translation_feedback

-   id
-   translation_id
-   participant_id
-   feedback_type
-   suggested_text (nullable)
-   created_at

### room_summaries

-   id
-   room_id
-   summary
-   action_items_json
-   generated_at
-   model_provider

Do not store raw audio by default. If audio storage is ever added, it
needs explicit consent, clear retention, access controls, and deletion.

## Real-time event types

Define and document typed events, including:

-   `participant.joined`
-   `participant.updated`
-   `participant.left`
-   `utterance.started`
-   `utterance.processing`
-   `utterance.transcribed`
-   `translation.ready`
-   `translation.failed`
-   `translation.feedback`
-   `playback.started`
-   `playback.stopped`
-   `room.updated`
-   `room.ended`
-   `connection.status`

Every event should include a room ID, event ID, timestamp, and relevant
participant/utterance identifiers. Validate all event payloads.

------------------------------------------------------------------------

# 9. API design

Create documented REST endpoints similar to:

  -----------------------------------------------------------------------------------------------
  Method                  Endpoint                                        Purpose
  ----------------------- ----------------------------------------------- -----------------------
  POST                    `/api/rooms`                                    Create a room

  POST                    `/api/rooms/join`                               Join with code

  GET                     `/api/rooms/{room_id}`                          Get room details

  GET                     `/api/rooms/{room_id}/participants`             List participants

  PATCH                   `/api/rooms/{room_id}/participants/me`          Update language/output
                                                                          preferences

  POST                    `/api/rooms/{room_id}/utterances`               Submit an
                                                                          utterance/audio
                                                                          reference

  GET                     `/api/rooms/{room_id}/transcript`               Retrieve permitted
                                                                          transcript

  POST                    `/api/rooms/{room_id}/glossary`                 Add glossary term

  POST                    `/api/translations/{translation_id}/feedback`   Submit translation
                                                                          feedback

  POST                    `/api/rooms/{room_id}/end`                      End room

  DELETE                  `/api/rooms/{room_id}/history`                  Delete retained history
                                                                          where authorised
  -----------------------------------------------------------------------------------------------

Use WebSockets for live room updates. Define authentication/guest
tokens, room membership checks, rate limits, and schema validation for
every endpoint.

Do not accept arbitrary provider URLs or arbitrary file paths from
clients.

------------------------------------------------------------------------

# 10. Provider selection and cost controls

Do not hardcode a speech or translation provider before testing the
target languages.

Evaluate providers using a real test set covering: - Kannada, Hindi,
Tamil, Telugu, Malayalam, and English. - Different accents and speaking
speeds. - Quiet and moderately noisy environments. - Mixed-language
sentences. - Proper nouns, place names, numbers, and technical
vocabulary. - Short and long utterances.

Score each provider on: 1. Recognition accuracy. 2. Translation meaning
preservation. 3. Language coverage. 4. End-to-end latency. 5. Speech
output naturalness. 6. Reliability and rate limits. 7. Data retention
and privacy terms. 8. Cost per minute and per participant.

## Cost-control requirements

-   Enforce maximum utterance duration and payload size.
-   Limit room size for the free tier.
-   Deduplicate translations by target language.
-   Cache eligible translations.
-   Avoid unnecessary TTS generation.
-   Offer captions-only mode.
-   Set per-user and per-room usage limits.
-   Record provider usage and estimated cost.
-   Add abuse protection and quotas.
-   Never let an unauthenticated guest trigger unlimited paid API usage.

Provide a configurable development/mock provider for automated tests
only. Clearly label mock mode in the UI and never use it in production
without an explicit configuration.

------------------------------------------------------------------------

# 11. Privacy, security, and consent

This is a communication product. Privacy is a core product requirement.

-   Ask for microphone permission only when a participant chooses to
    speak.
-   Show a clear visual indicator while recording.
-   Explain when audio is sent to an external provider.
-   Do not record in the background.
-   Do not store raw audio by default.
-   Make transcript retention a clear room setting.
-   Let the room owner and participants understand who can see the
    transcript.
-   Use short-lived guest access tokens.
-   Validate room membership on every read and write.
-   Use HTTPS and secure WebSockets.
-   Store secrets only on the server.
-   Apply rate limiting and abuse detection.
-   Protect against join-code guessing.
-   Avoid exposing private room contents in public URLs or logs.
-   Provide room deletion and data deletion controls.
-   Keep sensitive text out of application logs.
-   Provide a privacy policy before public launch.

For group rooms, make it clear that every participant is joining a
translated conversation and that speech may be processed by external
services. Do not enable recording or transcript retention without clear
notice and appropriate consent.

------------------------------------------------------------------------

# 12. Reliability and difficult real-world conditions

The product must handle:

-   Microphone permission denied.
-   Microphone unavailable or already in use.
-   Unsupported browser or audio codec.
-   Network drop during speech capture.
-   Participant disconnect/reconnect.
-   Provider timeout or rate limit.
-   Speech recognition failure.
-   Translation failure for one language while others succeed.
-   TTS failure.
-   Two participants speaking at once.
-   Duplicate utterance submission.
-   Late or out-of-order translation responses.
-   Room expiry.
-   Browser tab backgrounding.
-   Mobile battery and data constraints.

## Required behaviour

-   Preserve the original transcript if one translation fails.
-   Show partial status instead of freezing the whole room.
-   Use event IDs and idempotency keys to prevent duplicate utterances.
-   Sequence conversation events.
-   Provide reconnect and retry controls.
-   Never replay audio unexpectedly.
-   Do not queue unbounded audio or TTS.
-   Make the current speaker and processing status visible.
-   If simultaneous speech is detected or suspected, ask participants to
    take turns rather than silently merging utterances.

------------------------------------------------------------------------

# 13. Product quality: what "good" means

Do not claim BRIDGE is better than competitors until it has been tested.

Create an evaluation dashboard and test protocol.

## Suggested launch quality gates

These are targets to measure, not claims about current performance:

-   A new guest can join a room without creating an account.
-   A participant can select a language and complete a translated
    exchange.
-   A translation failure does not break the room.
-   The original transcript is available when recognition succeeds.
-   Participants see the correct speaker label.
-   Duplicate messages are not created after reconnect.
-   Users can stop microphone capture immediately.
-   The app works on representative Android and iOS browsers.
-   Every supported language pair has passed a human-reviewed test set.
-   Latency is measured from end of speech to visible translation and to
    audible playback.
-   Translation quality is judged for meaning, not just word-for-word
    similarity.

Track: - Speech recognition word error rate where reference transcripts
exist. - Human-rated translation adequacy. - End-of-speech-to-caption
latency. - End-of-speech-to-audio latency. - Provider failure rate. -
Reconnection success rate. - Cost per translated minute. - Room
completion rate. - Guest-to-returning-user conversion. - Percentage of
rooms where more than two languages are used.

------------------------------------------------------------------------

# 14. Product analytics and growth

Do not add social features just to inflate engagement. Measure whether
BRIDGE solves a real communication problem.

## Key events

-   `landing_viewed`
-   `room_created`
-   `invite_link_shared`
-   `room_joined`
-   `language_selected`
-   `microphone_permission_granted`
-   `utterance_submitted`
-   `translation_rendered`
-   `translation_replayed`
-   `translation_feedback_submitted`
-   `room_completed`
-   `transcript_exported`
-   `participant_returned`

## Growth loops

1.  A room owner invites people who speak different languages.
2.  Each participant experiences the product and can create their own
    room.
3.  A participant shares a room link for the next conversation.
4.  A classroom, club, business, or community adopts BRIDGE for
    recurring multilingual interactions.

Avoid spammy contact scraping or automatic invitations. Sharing must be
user initiated.

## Initial audience to validate

Start with: - Multilingual college groups. - Student clubs and project
teams. - Families with different language preferences. - Local
businesses serving multilingual customers.

Do not assume a mass market just because many people speak different
languages. Interview users and observe actual conversations before
scaling.

------------------------------------------------------------------------

# 15. Features to postpone

Do not let these delay the reliable core conversation experience:

-   Cellular call interception or translation.
-   WhatsApp/FaceTime call audio capture.
-   Fully simultaneous interpretation.
-   Automatic diarization from one room microphone.
-   Video calling.
-   Avatars and virtual worlds.
-   Public social feed.
-   Public room discovery.
-   Complex AI meeting assistant.
-   Automatic translation of every historical message.
-   Payments and subscriptions before cost is understood.
-   Native Android/iOS apps before the PWA has validated demand.

These can be considered later if users demonstrate a real need and the
relevant platform APIs permit them.

------------------------------------------------------------------------

# 16. Monetisation direction

Start with a useful free tier, then test paid usage once real provider
costs are understood.

Possible paid features: - Longer group sessions. - Larger rooms. - More
monthly translated minutes. - Saved transcripts and summaries. - Custom
glossaries. - Business and classroom administration. -
Organisation-level language and usage analytics.

Never promise unlimited translation if provider costs are variable.
Display clear limits and usage information.

------------------------------------------------------------------------

# 17. Deployment and operations

Provide: - Local development setup. - `.env.example` with descriptions
and no real secrets. - Database migrations. - Seed data clearly marked
as demo data. - Backend health endpoint. - Structured, privacy-safe
logs. - Error reporting. - Usage and provider-cost tracking. -
Production deployment instructions. - HTTPS and secure WebSocket
configuration. - Database backup and deletion procedures. - A staging
environment separate from production.

Suggested deployment shape: - Next.js frontend on a suitable web host. -
FastAPI backend on a host that supports persistent WebSocket
connections. - Managed PostgreSQL/Supabase. - Provider APIs called from
the backend. - Object storage only if a later feature explicitly
requires audio or file storage.

------------------------------------------------------------------------

# 18. Required repository structure

Use a clear structure similar to:

``` text
bridge/
  apps/
    web/
      app/
      components/
      hooks/
      lib/
      public/
      tests/
  services/
    api/
      app/
        api/
        core/
        db/
        models/
        schemas/
        services/
        realtime/
        providers/
          speech_to_text/
          translation/
          text_to_speech/
        tests/
      alembic/
  docs/
    architecture.md
    api.md
    privacy.md
    provider-evaluation.md
    testing.md
  .env.example
  README.md
```

Adapt this structure if the repository already has a sound architecture.
Do not create unnecessary services or split the system into
microservices prematurely.

------------------------------------------------------------------------

# 19. Required tests

## Backend tests

-   Room creation and joining.
-   Guest token expiry and room access control.
-   Participant language updates.
-   Provider adapter success and failure.
-   Translation caching.
-   Translation grouping by target language.
-   Duplicate utterance protection.
-   WebSocket membership enforcement.
-   Room expiry and deletion.
-   Rate limits and usage limits.

## Frontend tests

-   Create and join room.
-   Language selection.
-   Microphone permission denied.
-   Speak, process, and display translation.
-   Original text visibility.
-   Replay and stop TTS.
-   Disconnect and reconnect.
-   Partial translation failure.
-   Mobile responsive layouts.
-   Accessibility basics.

## End-to-end test

Use at least two independent browser sessions: - Session A speaks
English. - Session B selects Kannada. - A submits a real test
utterance. - B receives the Kannada translation. - B responds in
Kannada. - A receives the English translation.

Then test a third participant with Hindi. Use real providers in a
controlled staging test; mocks are only for automated tests.

------------------------------------------------------------------------

# 20. What Claude Code must deliver

At completion, the repository must contain:

1.  A working, responsive BRIDGE PWA.
2.  Room creation and QR/link joining.
3.  Guest participation.
4.  Per-participant language preferences.
5.  Real speech-to-text integration.
6.  Real translation integration.
7.  Real text-to-speech integration where supported.
8.  A live multi-participant conversation feed.
9.  Original text and translated text.
10. Context glossary.
11. Translation feedback.
12. Privacy and retention controls.
13. Provider-independent adapters.
14. Database migrations.
15. Automated tests.
16. `.env.example`.
17. Clear README and deployment instructions.
18. A documented list of tested languages and known limitations.
19. Usage and cost controls.
20. No fake production data or fake success states.

------------------------------------------------------------------------

# 21. Definition of done

BRIDGE is not done merely because the landing page looks good.

The minimum successful demonstration is:

-   One person creates a room.
-   Two or more other people join from their own phones using a link or
    QR code.
-   Each chooses a different language.
-   A participant speaks.
-   Real speech recognition produces the source text.
-   Real translation produces each recipient's preferred language.
-   The correct recipients see the correct translation.
-   Optional translated audio plays when enabled and supported.
-   Participants can inspect the original.
-   A failure in one provider or one target language does not crash the
    room.
-   Users can leave, end, and delete a room according to the retention
    policy.

If any part is simulated, disclose it clearly.

------------------------------------------------------------------------

# 22. Product strategy: the real differentiator

BRIDGE should not market itself as "Google Translate but with rooms."

Its product thesis is:

**Translation tools translate language. BRIDGE helps people have a
conversation together.**

That distinction only becomes real if BRIDGE delivers: - A shared
conversation timeline. - A personal language experience for every
participant. - Reliable speaker attribution. - Context-aware
terminology. - Low-friction group joining. - Clear conversational
controls. - Useful, consent-based conversation outcomes.

These are product hypotheses to validate, not proof that no competitor
offers them.

Before public launch, compare BRIDGE hands-on with Google Translate,
Microsoft Translator, and relevant group translation products. Test the
same scenarios, languages, devices, and network conditions. Identify a
measurable advantage. If no advantage appears, improve the experience or
narrow the target audience instead of making unsupported marketing
claims.

------------------------------------------------------------------------

# 23. Final instruction to Claude Code

Build BRIDGE as a real product, not a demo-only UI.

First inspect the repository and report: - Existing files and stack. -
Missing prerequisites. - Proposed architecture. - Provider options and
their language/streaming limitations. - Security and privacy risks.

Then implement the core end-to-end conversation flow with the smallest
reliable scope. Prioritise real speech recognition, translation, and
per-participant language delivery over decorative features.

Use typed schemas, provider adapters, secure server-side secrets,
database migrations, automated tests, clear errors, and complete
documentation.

Do not claim unsupported capabilities. Do not silently substitute mock
functionality. Do not access private call audio. Do not store raw audio
by default. Do not expose API keys.

When a provider or browser limitation prevents a feature, explain it and
implement the best transparent fallback.

**The goal is not to build the largest feature list. The goal is to make
a multilingual group conversation feel natural, reliable, private, and
dramatically easier than switching between separate translation tools.**
