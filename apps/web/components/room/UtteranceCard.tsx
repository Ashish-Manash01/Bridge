"use client";

import clsx from "clsx";
import { AlertTriangle, BookA, ChevronDown, Flag, Keyboard, Loader2, Pause, RefreshCw, Repeat2, Volume2 } from "lucide-react";
import { memo, useState } from "react";

import { Badge, Dots } from "@/components/ui";
import { dirOf, langName } from "@/lib/languages";
import type { Participant, PublicConfig, Translation, Utterance } from "@/lib/types";

import { Avatar, colorFor } from "./Participants";

export interface CardActions {
  onPlay: (t: Translation) => void;
  onStop: () => void;
  onReport: (u: Utterance, t: Translation | null) => void;
  onRepeat: (u: Utterance) => void;
  onRetryTranslation: (u: Utterance, lang: string) => void;
}

function time(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export const UtteranceCard = memo(function UtteranceCard({
  u,
  me,
  speaker,
  config,
  playingId,
  voiceAvailable,
  retrying,
  ...actions
}: {
  u: Utterance;
  me: Participant;
  speaker: Pick<Participant, "id" | "display_name">;
  config: PublicConfig | null;
  playingId: string | null;
  voiceAvailable: boolean;
  retrying: boolean;
} & CardActions) {
  const mine = u.participant_id === me.id;
  const myLang = me.preferred_language;
  const sameLanguage = u.source_language === myLang;
  const translation = u.translations.find((t) => t.target_language === myLang) ?? null;
  const [showOriginal, setShowOriginal] = useState(false);
  const pending = u.processing_status === "processing" || u.processing_status === "transcribed";

  const srcName = langName(config, u.source_language);
  const isPlaying = translation && playingId === translation.id;

  // What this participant reads first.
  let main: React.ReactNode;
  let mainLang = myLang;
  let status: React.ReactNode = null;
  if (u.processing_status === "failed") {
    main = <span className="text-ink-2">{u.error_message ?? "This message couldn't be processed."}</span>;
    status = <Badge tone="danger" icon={<AlertTriangle className="size-3" aria-hidden />}>Not recognised</Badge>;
  } else if (!u.original_text) {
    main = (
      <span className="inline-flex items-center gap-2 text-muted">
        <Dots label="Recognising speech" /> {mine ? "Recognising your speech…" : "Listening…"}
      </span>
    );
  } else if (mine || sameLanguage) {
    main = u.original_text;
    mainLang = u.source_language ?? myLang;
  } else if (translation?.quality_status === "failed") {
    main = u.original_text;
    mainLang = u.source_language ?? myLang;
    status = <Badge tone="danger" icon={<AlertTriangle className="size-3" aria-hidden />}>Translation failed · showing original</Badge>;
  } else if (translation?.translated_text) {
    main = translation.translated_text;
    if (translation.quality_status === "uncertain") {
      status = (
        <Badge tone="warning" icon={<AlertTriangle className="size-3" aria-hidden />}>
          Uncertain{translation.quality_note ? `: ${translation.quality_note}` : ""}
        </Badge>
      );
    }
  } else if (pending) {
    main = (
      <span className="inline-flex items-center gap-2 text-muted">
        <Dots label="Translating" /> Translating…
      </span>
    );
  } else {
    // Sent before this person joined or changed language: no translation exists yet.
    main = u.original_text;
    mainLang = u.source_language ?? myLang;
    status = <Badge tone="neutral">Not translated yet · showing original</Badge>;
  }

  const showOriginalBlock =
    !mine && !sameLanguage && !!u.original_text && !!translation && translation.quality_status !== "failed";

  return (
    <article
      className={clsx("animate-enter group flex gap-3", mine && "flex-row-reverse")}
      aria-label={`${mine ? "You" : speaker.display_name}${u.source_language ? `, spoke ${srcName}` : ""}`}
    >
      <Avatar p={speaker} size={34} />
      <div className={clsx("min-w-0 max-w-[min(36rem,85%)] flex-1", mine && "flex flex-col items-end")}>
        <header className={clsx("mb-1 flex flex-wrap items-baseline gap-x-2 text-xs", mine && "justify-end")}>
          <span className="font-semibold dark:brightness-[1.7]" style={{ color: mine ? undefined : colorFor(speaker.id) }}>{mine ? "You" : speaker.display_name}</span>
          {u.source_language && <span className="text-muted">spoke {srcName}</span>}
          {u.input_mode === "text" && (
            <span className="inline-flex items-center gap-0.5 text-muted">
              <Keyboard className="size-3" aria-hidden /> typed
            </span>
          )}
          <time className="text-muted" dateTime={u.created_at}>{time(u.created_at)}</time>
        </header>

        <div
          style={{ ["--speaker" as string]: colorFor(speaker.id) }}
          className={clsx(
            "rounded-[22px] px-4 py-3 transition-shadow",
            mine
              ? "rounded-tr-md bg-gradient-to-br from-primary-soft to-accent-soft/70"
              : "bubble-in rounded-tl-md border border-line bg-surface shadow-card",
            u.processing_status === "failed" && "border-danger/40",
          )}
        >
          <p lang={mainLang} dir={dirOf(config, mainLang)} className="script-text text-[17px] leading-relaxed text-ink">
            {main}
          </p>
          {(status || u.recognition_uncertain) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {status}
              {u.recognition_uncertain && !status && (
                <Badge tone="warning" icon={<AlertTriangle className="size-3" aria-hidden />}>Speech recognition unsure</Badge>
              )}
            </div>
          )}
          {translation && translation.glossary_terms.length > 0 && !mine && !sameLanguage && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted">
              <BookA className="size-3" aria-hidden /> Glossary: {translation.glossary_terms.join(", ")}
            </p>
          )}

          {showOriginalBlock && (
            <div className="mt-2 border-t border-line pt-2">
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                aria-expanded={showOriginal}
                className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-xs font-semibold text-muted hover:text-ink"
              >
                <ChevronDown className={clsx("size-3.5 transition-transform", showOriginal && "rotate-180")} aria-hidden />
                Original ({srcName})
              </button>
              {showOriginal && (
                <p lang={u.source_language ?? undefined} dir={dirOf(config, u.source_language)} className="script-text mt-1 text-[15px] text-ink-2">
                  {u.original_text}
                </p>
              )}
            </div>
          )}

          {mine && u.original_text && u.translations.length > 0 && (
            <p className="mt-2 border-t border-primary/15 pt-2 text-xs text-ink-2">
              Delivered in{" "}
              {u.translations.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <span className={t.quality_status === "failed" ? "text-danger" : undefined}>
                    {langName(config, t.target_language)}
                    {t.quality_status === "failed" ? " (failed)" : t.quality_status === "uncertain" ? " (uncertain)" : " ✓"}
                  </span>
                </span>
              ))}
            </p>
          )}
          {mine && pending && u.original_text && u.translations.length === 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Translating for others…
            </p>
          )}
        </div>

        {/* Actions */}
        {!mine && u.original_text && (
          <div className="mt-1 flex flex-wrap items-center gap-0.5 text-xs">
            {translation?.translated_text && voiceAvailable && (
              <ActionButton
                onClick={() => (isPlaying ? actions.onStop() : actions.onPlay(translation))}
                label={isPlaying ? "Stop audio" : "Play translation"}
                icon={isPlaying ? <Pause className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
              >
                {isPlaying ? "Stop" : "Play"}
              </ActionButton>
            )}
            {translation?.quality_status === "failed" && (
              <ActionButton onClick={() => actions.onRetryTranslation(u, myLang)} label="Retry translation" icon={retrying ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}>
                Retry
              </ActionButton>
            )}
            {!translation && !sameLanguage && !pending && (
              <ActionButton onClick={() => actions.onRetryTranslation(u, myLang)} label={`Translate into ${langName(config, myLang)}`} icon={retrying ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}>
                Translate
              </ActionButton>
            )}
            {translation?.translated_text && (
              <ActionButton onClick={() => actions.onReport(u, translation)} label="Translation seems wrong" icon={<Flag className="size-3.5" aria-hidden />}>
                Seems wrong
              </ActionButton>
            )}
            <ActionButton onClick={() => actions.onRepeat(u)} label={`Ask ${speaker.display_name} to repeat`} icon={<Repeat2 className="size-3.5" aria-hidden />}>
              Ask to repeat
            </ActionButton>
          </div>
        )}
        {!mine && u.processing_status === "failed" && (
          <div className="mt-1">
            <ActionButton onClick={() => actions.onRepeat(u)} label={`Ask ${speaker.display_name} to repeat`} icon={<Repeat2 className="size-3.5" aria-hidden />}>
              Ask to repeat
            </ActionButton>
          </div>
        )}
      </div>
    </article>
  );
});

function ActionButton({ onClick, label, icon, children }: { onClick: () => void; label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {icon}
      {children}
    </button>
  );
}
