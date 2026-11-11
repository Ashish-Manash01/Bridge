"use client";

import { MockBanner, SiteHeader } from "@/components/common";
import { useConfig } from "@/hooks/useConfig";

export default function PrivacyPage() {
  const { config } = useConfig();
  const p = config?.providers;
  const sections: [string, React.ReactNode][] = [
    [
      "Microphone",
      <>
        BRIDGE only asks for the microphone when you press <strong>Speak</strong>, and only listens until you stop. It never records in the
        background: switching tabs or locking your phone stops capture. You can view a room and read the conversation without allowing the microphone.
      </>,
    ],
    [
      "Speech recognition",
      p?.speech_to_text === "browser" ? (
        <>Your browser&apos;s built-in speech service recognises your speech. In Chrome that is Google, and in Safari it is Apple. BRIDGE only receives the resulting text.</>
      ) : (
        <>
          Audio for each utterance travels over an encrypted connection to the configured speech provider ({p?.speech_to_text ?? "…"}). BRIDGE holds it in memory for that request only and never writes it to storage.
        </>
      ),
    ],
    [
      "Translation",
      <>
        Recognised or typed text goes to the translation provider ({p?.translation ?? "…"}) once for each language in the room. A few recent
        messages and the room glossary may be included as context. Translations stay cached in memory for a few minutes to avoid repeat requests.
      </>,
    ],
    [
      "Translated voice",
      p?.text_to_speech === "browser" ? (
        <>Your device&apos;s own voices read translations aloud. Nothing extra is sent.</>
      ) : (
        <>When you choose to listen, the translated text goes to the voice provider ({p?.text_to_speech}) at that moment. Audio isn&apos;t pre-generated for everyone.</>
      ),
    ],
    [
      "Transcripts",
      <>
        The room owner picks a retention setting when creating the room, and everyone sees it before joining: <strong>Don&apos;t keep</strong> (deleted
        as soon as the room ends), <strong>24 hours</strong> or <strong>7 days</strong> after the end. Rooms also expire automatically after{" "}
        {config?.limits.room_ttl_hours ?? 6} hours. Only participants of a room can read its transcript. Anyone can delete their own messages, and
        the owner can delete the whole transcript at any time.
      </>,
    ],
    ["Raw audio", <>BRIDGE does not store raw audio. Changing that would require explicit consent, a clear retention period, access controls and deletion.</>],
    [
      "Guest passes",
      <>
        You join as a guest with a display name. Your browser keeps a short-lived pass for that room only, so refreshing the page doesn&apos;t remove you.
        Leaving the room cancels the pass.
      </>,
    ],
    ["Logs", <>Server logs record identifiers, timings and error codes. They never contain message text, names or tokens.</>],
    [
      "Limits of this service",
      <>
        Machine translation can be wrong. BRIDGE isn&apos;t a legal, medical or emergency interpretation service, and it can&apos;t access phone,
        WhatsApp or other apps&apos; call audio.
      </>,
    ],
  ];
  return (
    <>
      <MockBanner config={config} />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-2xl px-4 pb-16 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Privacy &amp; consent</h1>
        <p className="mt-2 text-ink-2">
          A plain-language guide to how BRIDGE handles your voice and words. The providers named here are the ones this server uses right now.
        </p>
        <dl className="mt-8 space-y-4">
          {sections.map(([title, body]) => (
            <div key={title} className="rounded-3xl border border-line bg-surface p-5">
              <dt className="font-semibold">{title}</dt>
              <dd className="mt-1.5 leading-relaxed text-ink-2">{body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-sm text-muted">This summary covers pilots and testing. A full privacy policy is required before a public launch.</p>
      </main>
    </>
  );
}
