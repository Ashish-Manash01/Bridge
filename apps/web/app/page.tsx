import {
  ArrowRight,
  BookA,
  Captions,
  Eye,
  Hand,
  Languages,
  Lock,
  Mic,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";

import { LiveDemo } from "@/components/brand/LiveDemo";
import { RotatingHello } from "@/components/brand/RotatingHello";
import { Logo } from "@/components/common";
import { ContinueRooms, LandingMockBanner } from "@/components/landing/Islands";

const SCRIPTS = [
  ["ನಮಸ್ಕಾರ", "kn"],
  ["नमस्ते", "hi"],
  ["வணக்கம்", "ta"],
  ["నమస్కారం", "te"],
  ["നമസ്കാരം", "ml"],
  ["Hello", "en"],
] as const;

export default function Landing() {
  return (
    <>
      <LandingMockBanner />

      {/* ---------------- Hero (night) ---------------- */}
      <div className="night relative overflow-hidden">
        <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden />
        <header className="relative mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo inverted />
          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link href="/languages" className="hidden rounded-lg px-3 py-2 text-white/70 hover:text-white sm:inline-block">
              Languages
            </Link>
            <Link href="/privacy" className="hidden rounded-lg px-3 py-2 text-white/70 hover:text-white sm:inline-block">
              Privacy
            </Link>
            <Link href="/join" className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 font-semibold text-white hover:bg-white/10">
              Join with code
            </Link>
          </nav>
        </header>

        <main id="main" className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pb-28 md:pt-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm font-medium text-white/80">
              <span className="relative flex size-2">
                <span className="animate-pulse-ring absolute inset-0 rounded-full bg-[#ffb46e]" />
                <span className="relative size-2 rounded-full bg-[#ffb46e]" />
              </span>
              Live multilingual rooms · no app needed
            </p>
            <h1 className="font-display mt-6 text-[2.75rem] font-semibold leading-[1.02] sm:text-6xl lg:text-[4.4rem]">
              Say <RotatingHello className="text-gradient" />
              <br />
              in your language.
              <br />
              <span className="text-white/55">They hear theirs.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70">
              BRIDGE is one room for a group that doesn&apos;t share a language. Everyone picks their own, presses Speak, and follows the
              whole conversation as captions or voice, with the speaker&apos;s name and the original a tap away.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/new"
                className="group inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-white px-6 text-base font-semibold text-[#0a0f1d] shadow-[0_10px_40px_-10px_rgba(127,240,228,0.6)] transition hover:-translate-y-0.5"
              >
                Start a conversation
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link
                href="/join"
                className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 text-base font-semibold text-white hover:bg-white/10"
              >
                <QrCode className="size-4" aria-hidden /> Scan or enter a code
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
              <li className="flex items-center gap-1.5"><Users className="size-4" aria-hidden /> Guests join with a name</li>
              <li className="flex items-center gap-1.5"><Lock className="size-4" aria-hidden /> Mic only while you press Speak</li>
              <li className="flex items-center gap-1.5"><Smartphone className="size-4" aria-hidden /> Works in any phone browser</li>
            </ul>

            <ContinueRooms />
          </div>

          <div>
            <LiveDemo />
          </div>
        </main>

        {/* Script marquee */}
        <div className="relative border-t border-white/10 bg-white/[0.02]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-6 text-2xl font-semibold text-white/50 sm:justify-between sm:text-3xl">
            {SCRIPTS.map(([w, lang]) => (
              <span key={lang} lang={lang} className="script-text transition-colors hover:text-white/80">
                {w}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- How it works ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent-ink">How it works</p>
        <h2 className="font-display mt-2 max-w-2xl text-3xl font-semibold sm:text-4xl">From “what did they say?” to a real conversation in under a minute.</h2>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            { icon: QrCode, t: "Create a room", d: "Pick your language. BRIDGE gives you a QR code, a link and a six-letter code.", tone: "bg-primary-soft text-primary" },
            { icon: Smartphone, t: "Everyone scans", d: "Friends open it in their phone browser, type a name and choose their language. No app, no account.", tone: "bg-accent-soft text-accent-ink" },
            { icon: Mic, t: "Talk, one at a time", d: "Press Speak and talk normally. Each person gets your words in their language, as captions or voice.", tone: "bg-live-soft text-live-ink" },
          ].map((s, i) => (
            <li key={s.t} className="group relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card transition hover:-translate-y-1 hover:shadow-pop">
              <span className="font-display absolute -right-2 -top-6 text-[7rem] font-bold leading-none text-ink/[0.04]" aria-hidden>
                {i + 1}
              </span>
              <span className={`flex size-12 items-center justify-center rounded-2xl ${s.tone}`}>
                <s.icon className="size-5" aria-hidden />
              </span>
              <p className="mt-5 text-lg font-semibold">{s.t}</p>
              <p className="mt-1.5 leading-relaxed text-ink-2">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- Bento ---------------- */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent-ink">Why BRIDGE</p>
        <h2 className="font-display mt-2 max-w-2xl text-3xl font-semibold sm:text-4xl">Built for a conversation, not a phrasebook.</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-6">
          <div className="night relative overflow-hidden rounded-3xl p-7 md:col-span-4 md:row-span-2">
            <Languages className="size-6 text-[#7ff0e4]" aria-hidden />
            <p className="font-display mt-4 text-2xl font-semibold">One conversation. A personal feed for each person.</p>
            <p className="mt-2 max-w-md text-white/70">
              The room has one shared timeline. BRIDGE translates each message once per language present and delivers it to the people who read
              that language.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { l: "Asha reads English", t: "Shall we meet at five?", c: "#7ff0e4" },
                { l: "Ravi reads ಕನ್ನಡ", t: "ನಾವು ಐದು ಗಂಟೆಗೆ ಭೇಟಿಯಾಗೋಣವೇ?", c: "#b7a6ff" },
                { l: "Meera reads हिन्दी", t: "क्या हम पाँच बजे मिलें?", c: "#ffb46e" },
              ].map((x) => (
                <div key={x.l} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold" style={{ color: x.c }}>{x.l}</p>
                  <p className="script-text mt-1.5 text-[15px] font-medium">{x.t}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-white/50">Illustration</p>
          </div>
          {[
            { icon: Eye, t: "Original always visible", d: "See exactly what was said. Unsure translations are flagged, never hidden.", cls: "md:col-span-2" },
            { icon: BookA, t: "Room glossary", d: "Names, places and course terms come through the way your group says them.", cls: "md:col-span-2" },
            { icon: Hand, t: "Conversation controls", d: "Replay, ask someone to repeat, flag a wrong translation, mute voice.", cls: "md:col-span-2" },
            { icon: Captions, t: "Captions or voice", d: "Read, listen, or both. Captions always work, even when audio can't play.", cls: "md:col-span-2" },
            { icon: Sparkles, t: "Optional AI summary", d: "With room consent: decisions, action items and open questions, clearly labelled.", cls: "md:col-span-2" },
          ].map((f) => (
            <div key={f.t} className={`rounded-3xl border border-line bg-surface p-6 shadow-card ${f.cls}`}>
              <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-ink">
                <f.icon className="size-5" aria-hidden />
              </span>
              <p className="mt-4 font-semibold">{f.t}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Trust ---------------- */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl bg-primary-soft p-7">
            <ShieldCheck className="size-6 text-primary" aria-hidden />
            <h2 className="font-display mt-4 text-2xl font-semibold">Private by default</h2>
            <p className="mt-2 leading-relaxed text-ink-2">
              The microphone only listens while you press Speak. Audio is never stored. Transcripts are deleted when the room ends unless the
              owner chooses to keep them, and everyone sees that choice before joining.
            </p>
            <Link href="/privacy" className="mt-4 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              How we handle your voice <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="rounded-3xl border border-line bg-surface p-7">
            <Captions className="size-6 text-accent-ink" aria-hidden />
            <h2 className="font-display mt-4 text-2xl font-semibold">Honest about limits</h2>
            <p className="mt-2 leading-relaxed text-ink-2">
              Machine translation makes mistakes, especially with mixed languages and noisy rooms. BRIDGE shows uncertainty and keeps the
              original. It isn&apos;t for legal, medical or emergency interpretation, and it can&apos;t translate phone or WhatsApp calls.
            </p>
            <Link href="/languages" className="mt-4 inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline">
              See language support <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="night relative mx-auto max-w-6xl overflow-hidden rounded-[32px] px-6 py-14 text-center sm:px-12">
          <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden />
          <h2 className="font-display relative text-3xl font-semibold sm:text-5xl">Your next conversation, in every language at the table.</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-white/70">Create a room in seconds. Share the QR code. Start talking.</p>
          <Link
            href="/new"
            className="group relative mt-8 inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-white px-7 text-base font-semibold text-[#0a0f1d] transition hover:-translate-y-0.5"
          >
            Start a conversation <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            <Logo compact /> One room, many languages, one conversation.
          </span>
          <span className="flex gap-5">
            <Link href="/languages" className="hover:text-ink">Language support</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/join" className="hover:text-ink">Join a room</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
