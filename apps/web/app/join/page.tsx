"use client";

import { ArrowLeft, DoorClosed, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import {
  CapabilityChips,
  ConsentNotice,
  FullPageMessage,
  LanguageSelect,
  MockBanner,
  OutputModeSelect,
  SiteHeader,
  useDeviceSupport,
} from "@/components/common";
import { FlowShell } from "@/components/FlowShell";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { useConfig } from "@/hooks/useConfig";
import { api, ApiError } from "@/lib/api";
import { langName } from "@/lib/languages";
import { prefs, sessions } from "@/lib/storage";
import type { OutputMode, RoomPreview } from "@/lib/types";

function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { config } = useConfig();
  const support = useDeviceSupport();

  const [code, setCode] = useState(() => normalizeCode(params.get("code") ?? ""));
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [checking, setChecking] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [language, setLanguage] = useState("en");
  const [outputMode, setOutputMode] = useState<OutputMode>("captions");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const p = prefs.get();
    if (p.display_name) setDisplayName(p.display_name);
    if (p.preferred_language) setLanguage(p.preferred_language);
    if (p.output_mode) setOutputMode(p.output_mode);
  }, []);

  const lookup = async (c: string) => {
    if (c.length !== 6) return;
    setChecking(true);
    setPreviewError(null);
    try {
      const pv = await api.preview(c);
      setPreview(pv);
      if (!pv.allowed_languages.includes(language)) setLanguage(pv.allowed_languages[0]);
    } catch (err) {
      setPreview(null);
      setPreviewError(err as ApiError);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (code.length === 6) void lookup(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const languages = useMemo(
    () => (config?.languages ?? []).filter((l) => !preview || preview.allowed_languages.includes(l.code)),
    [config, preview],
  );

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setError(new ApiError(422, "name", "Enter the name others will see."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await api.joinRoom({
        join_code: code,
        display_name: displayName.trim(),
        preferred_language: language,
        output_mode: outputMode,
        consent,
      });
      sessions.set(s);
      prefs.set({ display_name: displayName.trim(), preferred_language: language, output_mode: outputMode });
      router.push(`/room?id=${s.room.id}`);
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  if (preview?.status === "ended") {
    return (
      <FullPageMessage
        icon={<DoorClosed className="size-6" aria-hidden />}
        title="This conversation has ended"
        actions={
          <>
            <Link href="/new" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-ink">Start a new one</Link>
            <Button variant="secondary" onClick={() => { setPreview(null); setCode(""); }}>Enter another code</Button>
          </>
        }
      >
        Ask the person who invited you for a new link.
      </FullPageMessage>
    );
  }

  return (
    <FlowShell title="Join in your own language." points={["No app or account, just a name", "Pick the language you want to read and hear", "The microphone is only used when you press Speak", "The original words are always one tap away"]}>
      <Link href="/" className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      {!preview ? (
        <>
          <h1 className="font-display text-4xl font-semibold">Join a conversation</h1>
          <p className="mt-2 text-ink-2">Scan the QR code with your camera, or type the six-character code.</p>
          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup(code);
            }}
          >
            <Card className="space-y-4 p-5">
              <Field label="Room code" htmlFor="code" error={previewError?.message}>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(normalizeCode(e.target.value))}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABC234"
                  aria-invalid={!!previewError}
                  className="h-14 text-center font-mono text-2xl font-semibold tracking-[0.35em]"
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={checking} disabled={code.length !== 6}>
                Continue
              </Button>
            </Card>
          </form>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">You&apos;re invited to</p>
          <h1 className="mt-1 font-display text-4xl font-semibold">{preview.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Badge icon={<Users className="size-3" aria-hidden />}>
              {preview.participant_count} {preview.participant_count === 1 ? "person" : "people"} here
            </Badge>
            {preview.languages_in_use.map((l) => (
              <Badge key={l} tone="primary">{langName(config, l)}</Badge>
            ))}
          </div>
          {preview.full && <Notice tone="warning" className="mt-4">This room is full right now.</Notice>}
          <form onSubmit={join} className="mt-6 space-y-5" noValidate>
            <Card className="space-y-5 p-5">
              <Field label="Your name" htmlFor="name" hint="Shown next to everything you say." error={error?.code === "name" ? error.message : null}>
                <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} autoComplete="nickname" placeholder="e.g. Ravi" aria-invalid={error?.code === "name"} autoFocus />
              </Field>
              <div className="space-y-2">
                <LanguageSelect id="lang" label="Language you want to read and hear" value={language} onChange={setLanguage} languages={languages} />
                <CapabilityChips lang={languages.find((l) => l.code === language) ?? null} support={support} />
              </div>
              <OutputModeSelect value={outputMode} onChange={setOutputMode} />
              {!preview.voice_playback_enabled && outputMode !== "captions" && (
                <p className="text-sm text-warning">The owner has turned off translated voice. You&apos;ll see captions.</p>
              )}
            </Card>
            <ConsentNotice config={config} retention={preview.transcript_retention_mode} summaries={preview.summaries_enabled} checked={consent} onChange={setConsent} />
            {error && error.code !== "name" && <Notice tone="danger">{error.message}</Notice>}
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!consent || preview.full}>
              Join conversation
            </Button>
            <p className="text-center text-sm text-muted">You won&apos;t be asked for the microphone until you choose to speak.</p>
          </form>
        </>
      )}
    </FlowShell>
  );
}

export default function JoinPage() {
  const { config } = useConfig();
  return (
    <>
      <MockBanner config={config} />
      <SiteHeader right={<Link href="/new" className="rounded-lg px-3 py-2 font-semibold text-primary hover:bg-primary-soft">Start one</Link>} />
      <Suspense>
        <JoinInner />
      </Suspense>
    </>
  );
}
