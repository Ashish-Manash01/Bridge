"use client";

import clsx from "clsx";
import { AlertTriangle, Captions, Check, FlaskConical, Headphones, Mic, ShieldCheck, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { detectSupport, type DeviceSupport } from "@/lib/features";
import { testedLabel } from "@/lib/languages";
import type { LanguageCapability, OutputMode, PublicConfig, RetentionMode } from "@/lib/types";

import { Badge, Notice, Segmented } from "./ui";

export function Logo({ className, compact, inverted }: { className?: string; compact?: boolean; inverted?: boolean }) {
  return (
    <Link href="/" className={clsx("inline-flex items-center gap-2.5 rounded-lg", className)} aria-label="BRIDGE home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={32} height={32} className="size-8 rounded-[10px] shadow-sm" />
      {!compact && (
        <span className={clsx("font-display text-[19px] font-bold tracking-[-0.02em]", inverted ? "text-white" : "text-ink")}>
          bridge<span className={inverted ? "text-[#ffb46e]" : "text-live"}>.</span>
        </span>
      )}
    </Link>
  );
}

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line/60 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-sm font-medium">{right}</nav>
      </div>
    </header>
  );
}

export function MockBanner({ config }: { config: PublicConfig | null }) {
  if (!config?.mock_mode) return null;
  return (
    <div role="status" className="bg-warning-soft px-4 py-2 text-center text-sm font-semibold text-warning">
      <FlaskConical className="mr-1.5 inline size-4" aria-hidden />
      Mock mode: speech and translations are simulated for testing. Not real output.
    </div>
  );
}

export function useDeviceSupport(): DeviceSupport | null {
  const [s, setS] = useState<DeviceSupport | null>(null);
  useEffect(() => setS(detectSupport()), []);
  return s;
}

export function LanguageSelect({
  id,
  value,
  onChange,
  languages,
  label = "Language",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  languages: LanguageCapability[];
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full appearance-none rounded-xl border border-line-strong bg-surface pl-3.5 pr-10 text-base font-medium text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code} disabled={!l.translation}>
              {l.native_name === l.name ? l.name : `${l.native_name} · ${l.name}`}
              {!l.translation ? " (unavailable)" : ""}
            </option>
          ))}
        </select>
        <svg aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

/** Honest, per-language capability summary from the server matrix + this device.
 *  Device voices are deliberately NOT probed here: speechSynthesis.getVoices() can
 *  block the page on some Windows machines. Voices are checked only when someone
 *  actually plays a translation (lib/audio/player.ts), with captions as fallback. */
export function CapabilityChips({ lang, support }: { lang: LanguageCapability | null; support: DeviceSupport | null }) {
  if (!lang) return null;
  const input =
    lang.speech_input === "server"
      ? { ok: true, text: "Speech input" }
      : lang.speech_input === "device"
        ? support?.speechRecognition
          ? { ok: true, text: "Speech input (browser)" }
          : { ok: false, text: "Type only on this browser" }
        : { ok: false, text: "Type only" };
  const output =
    lang.speech_output === "server"
      ? { ok: true, text: "Translated voice" }
      : lang.speech_output === "device"
        ? { ok: true, text: "Voice (device-dependent)" }
        : { ok: false, text: "Captions only" };
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`${lang.name} support`}>
      {[input, output].map((c) => (
        <li key={c.text}>
          <Badge tone={c.ok ? "success" : "warning"} icon={c.ok ? <Check className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}>
            {c.text}
          </Badge>
        </li>
      ))}
      <li>
        <Badge tone={lang.tested === "human_reviewed" || lang.tested === "automated_pass" ? "primary" : "neutral"}>
          {testedLabel(lang)}
        </Badge>
      </li>
    </ul>
  );
}

export function OutputModeSelect({ value, onChange }: { value: OutputMode; onChange: (v: OutputMode) => void }) {
  return (
    <Segmented
      label="How you follow along"
      value={value}
      onChange={onChange}
      options={[
        { value: "captions", label: "Captions", icon: <Captions className="size-4" aria-hidden /> },
        { value: "both", label: "Both", icon: <Headphones className="size-4" aria-hidden /> },
        { value: "audio", label: "Voice", icon: <Volume2 className="size-4" aria-hidden /> },
      ]}
    />
  );
}

export const RETENTION_COPY: Record<RetentionMode, { label: string; detail: string }> = {
  ephemeral: { label: "Don't keep", detail: "The transcript is deleted when the conversation ends." },
  retain_24h: { label: "Keep 24 hours", detail: "Participants can review it for 24 hours after the end." },
  retain_7d: { label: "Keep 7 days", detail: "Participants can review it for 7 days after the end." },
};

export function ConsentNotice({
  config,
  retention,
  summaries,
  checked,
  onChange,
}: {
  config: PublicConfig | null;
  retention: RetentionMode;
  summaries: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const stt = config?.providers.speech_to_text;
  const sttLine =
    stt === "browser"
      ? "When you press Speak, your browser's speech service (Google in Chrome, Apple in Safari) turns your voice into text."
      : `When you press Speak, your audio is sent securely to our speech provider (${stt ?? "…"}) and is not stored.`;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface-2/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4 text-primary" aria-hidden /> Before you join
      </p>
      <ul className="space-y-2 text-sm leading-relaxed text-ink-2">
        <li className="flex gap-2">
          <Mic className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>
            The microphone is only used while you press <strong>Speak</strong>. Nothing is recorded in the background. {sttLine}
          </span>
        </li>
        <li className="flex gap-2">
          <Captions className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>
            Text is translated by an external service ({config?.providers.translation ?? "…"}). Machine translation can be wrong:
            the original is always one tap away.
          </span>
        </li>
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>
            Transcript: <strong>{RETENTION_COPY[retention].label.toLowerCase()}</strong>. {RETENTION_COPY[retention].detail} Only
            people in this room can see it.{summaries ? " The owner may generate an AI summary from it." : ""}
          </span>
        </li>
      </ul>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface p-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
        />
        <span className="text-sm font-medium">I understand this is a translated conversation and agree to how speech and text are processed.</span>
      </label>
      <p className="text-xs text-muted">
        Not for legal, medical or emergency interpretation. <Link href="/privacy" className="underline underline-offset-2">Privacy details</Link>
      </p>
    </div>
  );
}

export function FullPageMessage({
  icon,
  title,
  children,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <main id="main" className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">{icon}</div>
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <div className="mt-2 text-[15px] leading-relaxed text-muted">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </main>
  );
}

export { Notice };
