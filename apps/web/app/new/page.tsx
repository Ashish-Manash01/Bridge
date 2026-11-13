"use client";

import { ArrowLeft, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  CapabilityChips,
  ConsentNotice,
  LanguageSelect,
  MockBanner,
  OutputModeSelect,
  RETENTION_COPY,
  SiteHeader,
  useDeviceSupport,
} from "@/components/common";
import { FlowShell } from "@/components/FlowShell";
import { Button, Card, Field, Input, Notice, Segmented, Toggle } from "@/components/ui";
import { useConfig } from "@/hooks/useConfig";
import { api, ApiError } from "@/lib/api";
import { prefs, sessions } from "@/lib/storage";
import type { OutputMode, RetentionMode } from "@/lib/types";

export default function CreateRoomPage() {
  const router = useRouter();
  const { config, error: configError, retry } = useConfig();
  const support = useDeviceSupport();
  const languages = useMemo(() => config?.languages ?? [], [config]);

  const [displayName, setDisplayName] = useState("");
  const [language, setLanguage] = useState("en");
  const [outputMode, setOutputMode] = useState<OutputMode>("captions");
  const [roomName, setRoomName] = useState("");
  const [topic, setTopic] = useState("");
  const [retention, setRetention] = useState<RetentionMode>("ephemeral");
  const [voice, setVoice] = useState(true);
  const [summaries, setSummaries] = useState(false);
  const [allowed, setAllowed] = useState<string[]>([]);
  // Only send a language restriction if the host actually customised it; otherwise the
  // server allows every enabled language (avoids racing the list's initial fill).
  const [allowedTouched, setAllowedTouched] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const p = prefs.get();
    if (p.display_name) setDisplayName(p.display_name);
    if (p.preferred_language) setLanguage(p.preferred_language);
    if (p.output_mode) setOutputMode(p.output_mode);
  }, []);
  useEffect(() => {
    if (languages.length && !allowed.length) setAllowed(languages.filter((l) => l.translation).map((l) => l.code));
  }, [languages, allowed.length]);

  const fieldError = (f: string) => error?.fields.find((x) => x.field === f)?.message;
  const nameMissing = error?.code === "validation_error" && !displayName.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setError(new ApiError(422, "validation_error", "Please enter your name.", [{ field: "display_name", message: "Enter the name others will see." }]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const allowedFinal = Array.from(new Set([...allowed, language]));
      const s = await api.createRoom({
        display_name: displayName.trim(),
        preferred_language: language,
        output_mode: outputMode,
        consent,
        name: roomName.trim() || undefined,
        topic: topic.trim() || undefined,
        transcript_retention_mode: retention,
        voice_playback_enabled: voice,
        summaries_enabled: summaries,
        allowed_languages: allowedTouched ? allowedFinal : undefined,
      });
      sessions.set(s);
      prefs.set({ display_name: displayName.trim(), preferred_language: language, output_mode: outputMode });
      router.push(`/room?id=${s.room.id}&new=1`);
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <>
      <MockBanner config={config} />
      <SiteHeader right={<Link href="/join" className="rounded-lg px-3 py-2 font-semibold text-primary hover:bg-primary-soft">Join instead</Link>} />
      <FlowShell title="You're about to host a multilingual conversation." points={["Guests join from their phone browser with a QR code", "Everyone reads and hears in their own language", "You choose whether the transcript is kept", "End the room for everyone at any time"]}>
        <Link href="/" className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Link>
        <h1 className="font-display text-4xl font-semibold">Start a conversation</h1>
        <p className="mt-2 text-ink-2">You&apos;ll get a QR code and link to invite others. It takes a few seconds.</p>

        {configError && (
          <Notice tone="danger" className="mt-6" title="Can't reach BRIDGE" action={<Button size="sm" variant="secondary" onClick={retry}>Retry</Button>}>
            {configError}
          </Notice>
        )}

        <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
          <Card className="space-y-5 p-5">
            <Field label="Your name" htmlFor="name" hint="Shown next to everything you say." error={fieldError("display_name") ?? (nameMissing ? "Enter the name others will see." : null)}>
              <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} autoComplete="nickname" placeholder="e.g. Asha" aria-invalid={!!fieldError("display_name") || nameMissing} required />
            </Field>
            <div className="space-y-2">
              <LanguageSelect id="lang" label="Your language" value={language} onChange={setLanguage} languages={languages} />
              <CapabilityChips lang={languages.find((l) => l.code === language) ?? null} support={support} />
            </div>
            <OutputModeSelect value={outputMode} onChange={setOutputMode} />
          </Card>

          <Card className="space-y-5 p-5">
            <Field label="Conversation name (optional)" htmlFor="room">
              <Input id="room" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={80} placeholder={displayName ? `${displayName}'s conversation` : "Study group, Family dinner…"} />
            </Field>
            <Segmented
              label="Keep the transcript?"
              value={retention}
              onChange={setRetention}
              options={(Object.keys(RETENTION_COPY) as RetentionMode[]).map((k) => ({ value: k, label: RETENTION_COPY[k].label }))}
            />
            <p className="-mt-3 text-sm text-muted">{RETENTION_COPY[retention].detail}</p>

            <button type="button" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore} className="flex w-full items-center justify-between rounded-lg py-1 text-sm font-semibold text-ink-2">
              More room settings
              <ChevronDown className={`size-4 transition-transform ${showMore ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {showMore && (
              <div className="space-y-5">
                <Field label="Topic (optional)" htmlFor="topic" hint="Helps context-aware translation, e.g. “Physics lab: optics”.">
                  <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} />
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-semibold">Languages people can choose</legend>
                  <div className="flex flex-wrap gap-2">
                    {languages.filter((l) => l.translation).map((l) => {
                      const on = allowed.includes(l.code) || l.code === language;
                      return (
                        <label key={l.code} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${on ? "border-primary bg-primary-soft text-primary" : "border-line-strong text-ink-2"}`}>
                          <input type="checkbox" className="sr-only" checked={on} disabled={l.code === language} onChange={(e) => {
                            setAllowedTouched(true);
                            setAllowed((a) => (e.target.checked ? [...a, l.code] : a.filter((x) => x !== l.code)));
                          }} />
                          {l.native_name}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <Toggle id="voice" checked={voice} onChange={setVoice} label="Allow translated voice" detail="Participants can choose to hear translations read aloud." />
                <Toggle id="summ" checked={summaries} onChange={setSummaries} label="Allow AI summary" detail={config?.providers.summary ? "You can generate a labelled summary with action items from the transcript." : "Needs an AI provider configured on the server; currently unavailable."} disabled={!config?.providers.summary} />
              </div>
            )}
          </Card>

          <ConsentNotice config={config} retention={retention} summaries={summaries} checked={consent} onChange={setConsent} />

          {error && error.code !== "validation_error" && <Notice tone="danger">{error.message}</Notice>}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!consent || !config}>
            Create room
          </Button>
          {!consent && <p className="text-center text-sm text-muted">Tick the agreement above to continue.</p>}
        </form>
      </FlowShell>
    </>
  );
}
