"use client";

import clsx from "clsx";
import { Keyboard, Loader2, Mic, Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { VoiceOrb } from "@/components/brand/VoiceOrb";
import { IconButton } from "@/components/ui";
import { prefersReducedMotion } from "@/lib/features";
import type { SpeakPhase } from "@/hooks/useSpeak";

const HOLD_MS = 350;

export function SpeakDock({
  phase,
  level,
  elapsed,
  partial,
  maxSeconds,
  disabled,
  disabledReason,
  speechAvailable,
  someoneElseSpeaking,
  muted,
  onToggleMute,
  voiceAllowed,
  onStart,
  onStop,
  onCancel,
  onSendText,
  maxChars,
}: {
  phase: SpeakPhase;
  level: number;
  elapsed: number;
  partial: string;
  maxSeconds: number;
  disabled: boolean;
  disabledReason?: string;
  speechAvailable: boolean;
  someoneElseSpeaking: string | null;
  muted: boolean;
  onToggleMute: () => void;
  voiceAllowed: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onSendText: (text: string) => Promise<boolean>;
  maxChars: number;
}) {
  const [typing, setTyping] = useState(!speechAvailable);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const pressStart = useRef(0);
  const startedByPress = useRef(false);
  const recording = phase === "recording" || phase === "starting";
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => setReducedMotion(prefersReducedMotion()), []);

  useEffect(() => {
    if (!speechAvailable) setTyping(true);
  }, [speechAvailable]);

  // Space toggles speaking when focus isn't in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || disabled || typing || !speechAvailable) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.tagName === "BUTTON" || el.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      if (recording) onStop();
      else if (phase !== "submitting") onStart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, typing, recording, phase, onStart, onStop, speechAvailable]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || disabled) return;
    pressStart.current = performance.now();
    if (!recording && phase !== "submitting") {
      startedByPress.current = true;
      onStart();
    } else {
      startedByPress.current = false;
    }
  };
  const onPointerUp = () => {
    const held = performance.now() - pressStart.current;
    if (startedByPress.current) {
      // Held = push-to-talk: release stops. Quick tap = keeps recording until tapped again.
      if (held > HOLD_MS) onStop();
    } else if (recording) {
      onStop();
    }
    startedByPress.current = false;
  };
  const onKeyActivate = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (recording) onStop();
      else if (phase !== "submitting" && !disabled) onStart();
    }
  };

  const submitText = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const ok = await onSendText(t);
    setSending(false);
    if (ok) setText("");
  };

  const remaining = Math.max(0, maxSeconds - Math.floor(elapsed / 1000));
  const seconds = Math.floor(elapsed / 1000);

  return (
    <div className="safe-bottom border-t border-line/70 bg-surface/90 px-3 pt-2 shadow-[0_-12px_40px_-24px_rgba(15,18,34,0.35)] backdrop-blur-xl sm:px-4">
      <div className="mx-auto max-w-3xl">
        {/* Live status line */}
        <div className="mb-2 min-h-6 text-center text-sm" aria-live="polite">
          {recording ? (
            <span className="inline-flex items-center gap-2 font-semibold text-live-ink">
              <span className="relative flex size-2.5">
                <span className="animate-pulse-ring absolute inset-0 rounded-full bg-live" />
                <span className="relative size-2.5 rounded-full bg-live" />
              </span>
              Microphone on · {seconds}s{remaining <= 5 ? ` · stops in ${remaining}s` : ""}
            </span>
          ) : phase === "submitting" ? (
            <span className="inline-flex items-center gap-2 text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Sending…
            </span>
          ) : someoneElseSpeaking ? (
            <span className="text-muted">
              <strong className="font-semibold text-ink-2">{someoneElseSpeaking}</strong> is speaking…
            </span>
          ) : disabledReason ? (
            <span className="text-muted">{disabledReason}</span>
          ) : null}
        </div>
        {recording && partial && (
          <p className="script-text mx-auto mb-2 max-w-xl rounded-xl bg-surface-2 px-3 py-2 text-center text-[15px] text-ink-2" aria-live="polite">
            {partial}
          </p>
        )}

        {typing ? (
          <form onSubmit={submitText} className="flex items-end gap-2">
            {speechAvailable && (
              <IconButton label="Switch to speaking" onClick={() => setTyping(false)}>
                <Mic className="size-5" aria-hidden />
              </IconButton>
            )}
            <label htmlFor="compose" className="sr-only">Type a message</label>
            <textarea
              id="compose"
              rows={1}
              value={text}
              maxLength={maxChars}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitText(e);
                }
              }}
              placeholder={disabled ? "Room is closed" : "Type in your language…"}
              className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending || disabled}
              aria-label="Send message"
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-ink disabled:opacity-40"
            >
              {sending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <IconButton label="Type instead" onClick={() => setTyping(true)} disabled={recording}>
              <Keyboard className="size-5" aria-hidden />
            </IconButton>

            <div className="flex flex-col items-center">
              <div className="relative flex size-[104px] items-center justify-center">
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                  <VoiceOrb
                    state={disabled ? "disabled" : recording ? "listening" : phase === "submitting" ? "processing" : "idle"}
                    level={level}
                    size={104}
                    reducedMotion={reducedMotion}
                  />
                </span>
                <button
                  type="button"
                  disabled={disabled || phase === "submitting"}
                  onPointerDown={onPointerDown}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => recording && onCancel()}
                  onKeyDown={onKeyActivate}
                  onContextMenu={(e) => e.preventDefault()}
                  aria-pressed={recording}
                  aria-keyshortcuts="Space"
                  aria-label={recording ? "Stop speaking and send" : "Speak. Tap to start and tap again to send, or hold while talking"}
                  className={clsx(
                    "relative flex size-[68px] touch-none select-none items-center justify-center rounded-full text-white transition-transform active:scale-95 disabled:opacity-50",
                    recording ? "scale-105" : "hover:scale-[1.03]",
                  )}
                >
                  {phase === "submitting" ? (
                    <Loader2 className="size-8 animate-spin" aria-hidden />
                  ) : recording ? (
                    <Square className="size-7 fill-current" aria-hidden />
                  ) : (
                    <Mic className="size-8" aria-hidden />
                  )}
                </button>
              </div>
              <span className="-mt-1 text-xs font-semibold text-ink-2">{recording ? "Tap to send" : "Tap or hold to speak"}</span>
            </div>

            {recording ? (
              <IconButton label="Cancel recording" onClick={onCancel}>
                <X className="size-5" aria-hidden />
              </IconButton>
            ) : (
              <IconButton
                label={!voiceAllowed ? "Translated voice is off in this room" : muted ? "Unmute translated voice" : "Mute translated voice"}
                onClick={onToggleMute}
                disabled={!voiceAllowed}
                active={!muted && voiceAllowed}
              >
                {muted || !voiceAllowed ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
              </IconButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
