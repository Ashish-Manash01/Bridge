"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  BookA,
  DoorClosed,
  FileText,
  Mic,
  MoreHorizontal,
  QrCode,
  Repeat2,
  Settings2,
  SlidersHorizontal,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FullPageMessage, Logo, MockBanner, useDeviceSupport } from "@/components/common";
import { Badge, Button, IconButton, Notice, Sheet } from "@/components/ui";
import { useRoom } from "@/hooks/useRoom";
import { useSpeak } from "@/hooks/useSpeak";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { langName, localeOf } from "@/lib/languages";
import { orderedUtterances } from "@/lib/roomState";
import { sessions } from "@/lib/storage";
import type { PublicConfig, Session, Translation, Utterance } from "@/lib/types";

import { InvitePanel } from "./Invite";
import { Avatar, ParticipantList } from "./Participants";
import { FeedbackSheet, GlossarySheet, PreferencesSheet, RoomSettingsSheet } from "./Sheets";
import { SpeakDock } from "./SpeakDock";
import { UtteranceCard } from "./UtteranceCard";

type Panel = null | "invite" | "people" | "prefs" | "glossary" | "settings" | "mic";

export function RoomView({ initial, config, justCreated }: { initial: Session; config: PublicConfig | null; justCreated: boolean }) {
  const router = useRouter();
  const ctl = useRoom(initial, config);
  const { state, me, session, player, playerState, dispatch } = ctl;
  const room = state.room ?? session.room;
  const isOwner = me.role === "owner";
  const support = useDeviceSupport();
  const participants = useMemo(() => Object.values(state.participants), [state.participants]);
  const utterances = orderedUtterances(state);
  const [panel, setPanel] = useState<Panel>(justCreated ? "invite" : null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ u: Utterance; t: Translation | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [micPrimed, setMicPrimed] = useState(false);

  useEffect(() => {
    try {
      setMicPrimed(sessionStorage.getItem("bridge.micPrimed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  // Speech input mode: server STT if configured, else browser recognition.
  const sttMode = config?.providers.speech_to_text === "browser" ? "browser" : "server";
  const spokenLang = me.spoken_language ?? me.preferred_language;
  const speechAvailable =
    !!support && (sttMode === "server" ? support.microphone : support.speechRecognition && support.secureContext);
  const active = room.status === "active" && state.connection !== "ended";

  const speak = useSpeak({
    roomId: room.id,
    token: () => ctl.session.token,
    mode: sttMode,
    locale: localeOf(config, spokenLang),
    language: spokenLang,
    maxSeconds: config?.limits.max_utterance_seconds ?? 30,
    onFloor: (taking) => ctl.sendWs({ type: taking ? "floor.request" : "floor.release" }),
    onSubmitted: (u) => dispatch({ kind: "localUtterance", utterance: u }),
    onBeforeStart: () => {
      player.unlock();
      player.stop(); // don't play translations into your own microphone
    },
  });

  const startSpeaking = useCallback(() => {
    if (!micPrimed) {
      setPanel("mic");
      return;
    }
    void speak.start();
  }, [micPrimed, speak]);

  const confirmMic = () => {
    try {
      sessionStorage.setItem("bridge.micPrimed", "1");
    } catch {
      /* ignore */
    }
    setMicPrimed(true);
    setPanel(null);
    void speak.start();
  };

  const sendText = useCallback(
    async (text: string) => {
      player.unlock();
      try {
        const u = await api.sendText(room.id, ctl.session.token, {
          idempotency_key: newIdempotencyKey(),
          text,
          input_mode: "text",
          source_language: spokenLang,
        });
        dispatch({ kind: "localUtterance", utterance: u });
        return true;
      } catch (e) {
        showToast((e as ApiError).message);
        return false;
      }
    },
    [room.id, ctl.session.token, spokenLang, dispatch, showToast, player],
  );

  // Auto-scroll when new messages arrive, unless the reader scrolled up.
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = utterances[utterances.length - 1];
  const feedKey = `${utterances.length}:${last?.translations.length ?? 0}:${last?.original_text ?? ""}`;
  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [feedKey]);

  const voiceAvailable = room.voice_playback_enabled;
  const speakingOthers = state.speaking.filter((id) => id !== me.id);
  const someoneElse = speakingOthers.length ? state.participants[speakingOthers[0]]?.display_name ?? "Someone" : null;

  const actions = useMemo(
    () => ({
      onPlay: (t: Translation) => {
        player.unlock();
        ctl.play(t, true);
      },
      onStop: () => player.stop(),
      onReport: (u: Utterance, t: Translation | null) => setFeedbackTarget({ u, t }),
      onRepeat: async (u: Utterance) => {
        try {
          await api.repeat(room.id, ctl.session.token, u.id);
          showToast(`Asked ${u.speaker_name} to repeat`);
        } catch (e) {
          showToast((e as ApiError).message);
        }
      },
      onRetryTranslation: async (u: Utterance, lang: string) => {
        setRetrying(u.id);
        try {
          const t = await api.translateOne(room.id, ctl.session.token, u.id, lang);
          dispatch({ kind: "translation", translation: t });
          if (t.quality_status === "failed") showToast("Translation is still unavailable. The original is shown.");
        } catch (e) {
          showToast((e as ApiError).message);
        } finally {
          setRetrying(null);
        }
      },
    }),
    [player, ctl, room.id, dispatch, showToast],
  );

  const leave = async () => {
    try {
      await api.leave(room.id, ctl.session.token);
    } finally {
      sessions.clear(room.id);
      router.push("/");
    }
  };

  // --- Terminal states ------------------------------------------------------
  if (state.connection === "unauthorized") {
    sessions.clear(room.id);
    return (
      <FullPageMessage
        icon={<DoorClosed className="size-6" aria-hidden />}
        title="Your session for this room ended"
        actions={<Link href={`/join?code=${room.join_code}`} className="inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-ink">Join again</Link>}
      >
        You may have left the room, or your guest pass expired.
      </FullPageMessage>
    );
  }

  const speakerOf = (u: Utterance) => state.participants[u.participant_id] ?? { id: u.participant_id, display_name: u.speaker_name || "Former participant" };
  const playingId = playerState.status === "playing" ? playerState.translationId : null;
  const feedbackSpeaker = feedbackTarget ? speakerOf(feedbackTarget.u).display_name : "";

  return (
    <div className="flex h-dvh flex-col">
      <MockBanner config={config} />
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-4">
        <Logo compact className="hidden sm:inline-flex" />
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight sm:text-base">{room.name}</h1>
          <ConnectionLabel status={state.connection} count={participants.length} />
        </div>
        <button
          type="button"
          onClick={() => setPanel("people")}
          className="flex h-11 items-center gap-1.5 rounded-xl px-2 hover:bg-surface-2 lg:hidden"
          aria-label={`${participants.length} participants`}
        >
          <div className="flex -space-x-2">
            {participants.slice(0, 3).map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-surface"><Avatar p={p} size={26} speaking={state.speaking.includes(p.id)} /></span>
            ))}
          </div>
          {participants.length > 3 && <span className="text-xs font-semibold text-muted">+{participants.length - 3}</span>}
        </button>
        <IconButton label="Invite people" onClick={() => setPanel("invite")} disabled={!active}>
          <QrCode className="size-5" aria-hidden />
        </IconButton>
        <IconButton label="Language and audio" onClick={() => setPanel("prefs")}>
          <SlidersHorizontal className="size-5" aria-hidden />
        </IconButton>
        <RoomMenu
          onGlossary={() => setPanel("glossary")}
          onSettings={() => setPanel("settings")}
          transcriptHref={`/transcript?id=${room.id}`}
          isOwner={isOwner}
        />
      </header>

      {state.connection === "reconnecting" || state.connection === "offline" ? (
        <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm font-medium text-warning">
          <WifiOff className="size-4" aria-hidden />
          {state.connection === "offline" ? "You're offline. Messages will sync when you reconnect." : "Reconnecting…"}
          <button type="button" onClick={ctl.retryConnection} className="ml-1 rounded-md px-2 py-0.5 font-semibold underline underline-offset-2">Retry now</button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Feed */}
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          <div
            ref={feedRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
            className="min-h-0 flex-1 overflow-y-auto"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={`Conversation in ${langName(config, me.preferred_language)}`}
          >
            <div className="mx-auto max-w-3xl space-y-5 px-3 py-5 sm:px-6">
              {state.notices.map((n) => (
                <Notice
                  key={n.id}
                  tone={n.type === "repeat_request" ? "live" : "warning"}
                  icon={n.type === "repeat_request" ? <Repeat2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
                  title={n.type === "repeat_request" ? `${n.fromName} asked you to repeat` : `${n.fromName} flagged a translation of your message`}
                  action={<IconButton label="Dismiss" onClick={() => dispatch({ kind: "dismissNotice", id: n.id })}><X className="size-4" aria-hidden /></IconButton>}
                >
                  {n.suggestedText ? <>They think it means: “{n.suggestedText}”</> : n.type === "repeat_request" ? "Try saying it again, a little slower or in simpler words." : "Consider rephrasing."}
                </Notice>
              ))}
              {utterances.length === 0 ? (
                <EmptyFeed alone={participants.length < 2} onInvite={() => setPanel("invite")} config={config} languages={[...new Set(participants.map((p) => p.preferred_language))]} active={active} />
              ) : (
                utterances.map((u) => (
                  <UtteranceCard
                    key={u.id}
                    u={u}
                    me={me}
                    speaker={speakerOf(u)}
                    config={config}
                    playingId={playingId}
                    voiceAvailable={voiceAvailable}
                    retrying={retrying === u.id}
                    {...actions}
                  />
                ))
              )}
              {playerState.status === "error" && (
                <Notice tone="warning" icon={<AlertTriangle className="size-4" aria-hidden />}>{playerState.message}</Notice>
              )}
            </div>
          </div>

          {state.connection === "ended" || room.status === "ended" ? (
            <div className="safe-bottom border-t border-line bg-surface px-4 pt-4 text-center">
              <p className="font-semibold">This conversation has ended.</p>
              <p className="mt-1 text-sm text-muted">
                {room.transcript_retention_mode === "ephemeral" ? "The transcript has been deleted." : "The transcript is available for a limited time."}
              </p>
              <div className="mt-3 flex justify-center gap-2">
                {room.transcript_retention_mode !== "ephemeral" && <Link href={`/transcript?id=${room.id}`} className="inline-flex h-11 items-center rounded-xl border border-line-strong px-4 font-semibold">View transcript</Link>}
                <Link href="/new" className="inline-flex h-11 items-center rounded-xl bg-primary px-4 font-semibold text-primary-ink">Start a new one</Link>
              </div>
            </div>
          ) : (
            <>
              {(speak.error || state.floorBusy) && (
                <div className="mx-auto w-full max-w-3xl px-3 pb-2 sm:px-6">
                  {speak.error ? (
                    <Notice
                      tone="danger"
                      icon={<Mic className="size-4" aria-hidden />}
                      title={speak.error.message}
                      action={<IconButton label="Dismiss" onClick={speak.dismissError}><X className="size-4" aria-hidden /></IconButton>}
                    />
                  ) : (
                    <Notice
                      tone="live"
                      title={`${state.floorBusy} is already speaking`}
                      action={<IconButton label="Dismiss" onClick={() => dispatch({ kind: "clearFloorBusy" })}><X className="size-4" aria-hidden /></IconButton>}
                    >
                      Taking turns keeps translations clear. Your message will still be sent.
                    </Notice>
                  )}
                </div>
              )}
              <SpeakDock
                phase={speak.phase}
                level={speak.level}
                elapsed={speak.elapsed}
                partial={speak.partial}
                maxSeconds={config?.limits.max_utterance_seconds ?? 30}
                disabled={!active || state.connection === "connecting"}
                disabledReason={!speechAvailable && support ? speechUnavailableReason(sttMode, support) : undefined}
                speechAvailable={speechAvailable}
                someoneElseSpeaking={someoneElse}
                muted={me.audio_muted || me.output_mode === "captions"}
                voiceAllowed={voiceAvailable}
                onToggleMute={() => {
                  player.unlock();
                  const willMute = !(me.audio_muted || me.output_mode === "captions");
                  if (willMute) player.stop();
                  const patch = me.output_mode === "captions" && !willMute ? { audio_muted: false, output_mode: "both" as const } : { audio_muted: willMute };
                  ctl.updateMe(patch).catch((e) => showToast(e.message));
                }}
                onStart={startSpeaking}
                onStop={() => void speak.stop()}
                onCancel={speak.cancel}
                onSendText={sendText}
                maxChars={config?.limits.max_text_chars ?? 600}
              />
            </>
          )}
        </main>

        {/* Desktop sidebar */}
        <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4 lg:flex" aria-label="Room details">
          <section>
            <h2 className="mb-2 flex items-center gap-2 px-2 text-sm font-semibold"><Users className="size-4 text-muted" aria-hidden /> People ({participants.length})</h2>
            <ParticipantList participants={participants} meId={me.id} speaking={state.speaking} config={config} />
          </section>
          {active && (
            <section className="rounded-2xl border border-line p-4">
              <h2 className="mb-3 text-sm font-semibold">Invite</h2>
              <InvitePanel room={room} compact />
            </section>
          )}
        </aside>
      </div>

      {/* Panels */}
      <Sheet open={panel === "invite"} onClose={() => setPanel(null)} title="Invite people" description="They join from their phone's browser. No app or account needed.">
        <InvitePanel room={room} />
        {justCreated && (
          <p className="mt-4 text-center text-sm text-muted">You can reopen this any time from the QR button at the top.</p>
        )}
      </Sheet>
      <Sheet open={panel === "people"} onClose={() => setPanel(null)} title={`People (${participants.length})`}>
        <ParticipantList participants={participants} meId={me.id} speaking={state.speaking} config={config} />
        {active && <Button variant="secondary" className="mt-4 w-full" onClick={() => setPanel("invite")} icon={<QrCode className="size-4" aria-hidden />}>Invite more</Button>}
      </Sheet>
      <PreferencesSheet open={panel === "prefs"} onClose={() => setPanel(null)} me={me} room={room} config={config} onSave={ctl.updateMe} />
      <GlossarySheet open={panel === "glossary"} onClose={() => setPanel(null)} room={room} token={session.token} isOwner={isOwner} version={state.glossaryVersion} />
      <RoomSettingsSheet open={panel === "settings"} onClose={() => setPanel(null)} room={room} token={session.token} isOwner={isOwner} onLeave={leave} onEnded={() => setPanel(null)} />
      <FeedbackSheet target={feedbackTarget} onClose={() => setFeedbackTarget(null)} token={session.token} roomId={room.id} config={config} speakerName={feedbackSpeaker} />
      <Sheet
        open={panel === "mic"}
        onClose={() => setPanel(null)}
        title="Before you speak"
        footer={<Button size="lg" className="mb-1 w-full" onClick={confirmMic} icon={<Mic className="size-5" aria-hidden />}>Start speaking</Button>}
      >
        <ul className="space-y-3 text-[15px] leading-relaxed text-ink-2">
          <li>Your browser will ask to use the microphone. It&apos;s only on while the button is orange, and you can stop any time.</li>
          <li>
            {sttMode === "browser"
              ? "Your speech is turned into text by your browser's speech service (Google in Chrome, Apple in Safari)."
              : `Your audio is sent securely to ${config?.providers.speech_to_text} for recognition and is never stored.`}{" "}
            Speak in <strong>{langName(config, spokenLang)}</strong>. You can change this in Language &amp; audio.
          </li>
          <li>Tap once to start and again to send, or hold the button while you talk. One person at a time works best.</li>
        </ul>
      </Sheet>

      {toast && (
        <div role="status" className="animate-enter fixed inset-x-0 bottom-32 z-40 mx-auto w-fit max-w-[90vw] rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg shadow-pop">
          {toast}
        </div>
      )}
    </div>
  );
}

function speechUnavailableReason(mode: "server" | "browser", s: NonNullable<ReturnType<typeof useDeviceSupport>>) {
  if (!s.secureContext) return "Speaking needs a secure (https) connection. You can still type.";
  if (mode === "browser" && !s.speechRecognition) return "This browser can't recognise speech. Try Chrome or Safari, or type instead.";
  if (!s.microphone) return "No microphone access in this browser. You can type instead.";
  return undefined;
}

function ConnectionLabel({ status, count }: { status: string; count: number }) {
  const map: Record<string, { text: string; cls: string }> = {
    connecting: { text: "Connecting…", cls: "bg-warning" },
    connected: { text: `Live · ${count} ${count === 1 ? "person" : "people"}`, cls: "bg-success" },
    reconnecting: { text: "Reconnecting…", cls: "bg-warning" },
    offline: { text: "Offline", cls: "bg-danger" },
    ended: { text: "Ended", cls: "bg-line-strong" },
    unauthorized: { text: "Session ended", cls: "bg-danger" },
  };
  const m = map[status] ?? map.connecting;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted" role="status">
      <span className={clsx("size-1.5 rounded-full", m.cls)} aria-hidden /> {m.text}
    </p>
  );
}

function RoomMenu({ onGlossary, onSettings, transcriptHref, isOwner }: { onGlossary: () => void; onSettings: () => void; transcriptHref: string; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const item = "flex w-full min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium hover:bg-surface-2";
  return (
    <div className="relative" ref={ref}>
      <IconButton label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="size-5" aria-hidden />
      </IconButton>
      {open && (
        <div role="menu" className="animate-enter absolute right-0 top-12 z-30 w-60 rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onGlossary(); }}><BookA className="size-4 text-muted" aria-hidden /> Glossary</button>
          <Link role="menuitem" className={item} href={transcriptHref}><FileText className="size-4 text-muted" aria-hidden /> Transcript & export</Link>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onSettings(); }}><Settings2 className="size-4 text-muted" aria-hidden /> {isOwner ? "Room settings & end" : "Privacy & leave"}</button>
        </div>
      )}
    </div>
  );
}

function EmptyFeed({ alone, onInvite, config, languages, active }: { alone: boolean; onInvite: () => void; config: PublicConfig | null; languages: string[]; active: boolean }) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        {alone ? <Users className="size-6" aria-hidden /> : <Mic className="size-6" aria-hidden />}
      </div>
      <h2 className="mt-4 text-lg font-semibold">{alone ? "Waiting for others to join" : "Ready when you are"}</h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
        {alone
          ? "Share the QR code or link. Each person picks their own language when they join."
          : "Press the button and speak naturally. Everyone will see your words in their language."}
      </p>
      {languages.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {languages.map((l) => <Badge key={l} tone="primary">{langName(config, l)}</Badge>)}
        </div>
      )}
      {alone && active && <Button className="mt-5" onClick={onInvite} icon={<QrCode className="size-4" aria-hidden />}>Show invite</Button>}
    </div>
  );
}
