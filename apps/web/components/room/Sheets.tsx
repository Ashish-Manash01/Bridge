"use client";

import { BookA, Check, Loader2, Repeat2, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CapabilityChips, LanguageSelect, OutputModeSelect, RETENTION_COPY, useDeviceSupport } from "@/components/common";
import { Badge, Button, Field, Input, Notice, Segmented, Sheet, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { langName } from "@/lib/languages";
import type { GlossaryEntry, Participant, PublicConfig, RetentionMode, Room, Summary, Translation, Usage, Utterance } from "@/lib/types";

// --- Preferences -------------------------------------------------------------

export function PreferencesSheet({
  open,
  onClose,
  me,
  room,
  config,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  me: Participant;
  room: Room;
  config: PublicConfig | null;
  onSave: (patch: Partial<Participant>) => Promise<void>;
}) {
  const support = useDeviceSupport();
  const [lang, setLang] = useState(me.preferred_language);
  const [spoken, setSpoken] = useState(me.spoken_language ?? me.preferred_language);
  const [mode, setMode] = useState(me.output_mode);
  const [name, setName] = useState(me.display_name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setLang(me.preferred_language);
      setSpoken(me.spoken_language ?? me.preferred_language);
      setMode(me.output_mode);
      setName(me.display_name);
      setError(null);
    }
  }, [open, me]);
  const languages = (config?.languages ?? []).filter((l) => room.allowed_languages.includes(l.code));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ preferred_language: lang, spoken_language: spoken, output_mode: mode, display_name: name.trim() || me.display_name });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Language & audio"
      description="Changes apply to new messages. Earlier messages can be translated on request."
      footer={
        <Button className="mb-1 w-full" size="lg" onClick={save} loading={busy}>
          Save preferences
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Display name" htmlFor="pref-name">
          <Input id="pref-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="space-y-2">
          <LanguageSelect id="pref-lang" label="I read and listen in" value={lang} onChange={setLang} languages={languages} />
          <CapabilityChips lang={languages.find((l) => l.code === lang) ?? null} support={support} />
        </div>
        <div className="space-y-1.5">
          <LanguageSelect id="pref-spoken" label="I usually speak" value={spoken} onChange={setSpoken} languages={languages} />
          <p className="text-sm text-muted">
            Speech recognition listens for this language. If you mix languages (for example Kannada with English words), pick the one
            you use most.
          </p>
        </div>
        <OutputModeSelect value={mode} onChange={setMode} />
        {!room.voice_playback_enabled && mode !== "captions" && (
          <Notice tone="warning">The room owner has turned off translated voice. You&apos;ll see captions.</Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// --- Glossary ---------------------------------------------------------------

export function GlossarySheet({
  open,
  onClose,
  room,
  token,
  isOwner,
  version,
}: {
  open: boolean;
  onClose: () => void;
  room: Room;
  token: string;
  isOwner: boolean;
  version: number;
}) {
  const [items, setItems] = useState<GlossaryEntry[] | null>(null);
  const [term, setTerm] = useState("");
  const [rendering, setRendering] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.glossary(room.id, token));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [room.id, token]);
  useEffect(() => {
    if (open) void load();
  }, [open, load, version]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addGlossary(room.id, token, { source_term: term.trim(), preferred_translation: rendering.trim() || null, note: note.trim() || null });
      setTerm("");
      setRendering("");
      setNote("");
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const approved = items?.filter((i) => i.status === "approved") ?? [];
  const suggested = items?.filter((i) => i.status === "suggested") ?? [];

  return (
    <Sheet open={open} onClose={onClose} title="Room glossary" description="Names, places and terms your group uses. They're passed to the translator as hints." wide>
      <form onSubmit={add} className="space-y-3 rounded-2xl bg-surface-2/70 p-4">
        <p className="text-sm font-semibold">{isOwner ? "Add a term" : "Suggest a term"}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Term as spoken" htmlFor="g-term">
            <Input id="g-term" value={term} maxLength={80} onChange={(e) => setTerm(e.target.value)} placeholder="e.g. Jayanagar, BRIDGE, Priya" />
          </Field>
          <Field label="Preferred rendering (optional)" htmlFor="g-render" hint="Leave blank to keep the term unchanged.">
            <Input id="g-render" value={rendering} maxLength={120} onChange={(e) => setRendering(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)" htmlFor="g-note">
          <Input id="g-note" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="e.g. a neighbourhood in Bengaluru" />
        </Field>
        <Button type="submit" loading={busy} disabled={!term.trim() || room.status !== "active"} icon={<BookA className="size-4" aria-hidden />}>
          {isOwner ? "Add to glossary" : "Send suggestion to owner"}
        </Button>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>

      <p className="mt-4 text-xs text-muted">
        BRIDGE never silently swaps meaning. When a glossary term is used in a translation, the message shows it. If the translator can&apos;t
        keep a term, the message says so.
      </p>

      {items === null ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading…</p>
      ) : (
        <>
          {isOwner && suggested.length > 0 && (
            <section className="mt-5">
              <h3 className="text-sm font-semibold">Suggestions</h3>
              <GlossaryList items={suggested} onApprove={async (id) => { await api.approveGlossary(room.id, token, id); await load(); }} onDelete={async (id) => { await api.deleteGlossary(room.id, token, id); await load(); }} />
            </section>
          )}
          <section className="mt-5">
            <h3 className="text-sm font-semibold">In use ({approved.length})</h3>
            {approved.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No terms yet.</p>
            ) : (
              <GlossaryList items={approved} onDelete={isOwner ? async (id) => { await api.deleteGlossary(room.id, token, id); await load(); } : undefined} />
            )}
          </section>
          {!isOwner && suggested.length > 0 && (
            <p className="mt-3 text-sm text-muted">{suggested.length} suggestion(s) waiting for the owner.</p>
          )}
        </>
      )}
    </Sheet>
  );
}

function GlossaryList({ items, onApprove, onDelete }: { items: GlossaryEntry[]; onApprove?: (id: string) => Promise<void>; onDelete?: (id: string) => Promise<void> }) {
  return (
    <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
      {items.map((g) => (
        <li key={g.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="script-text font-medium">
              {g.source_term}
              {g.preferred_translation && <span className="text-muted"> → {g.preferred_translation}</span>}
            </p>
            {g.note && <p className="text-sm text-muted">{g.note}</p>}
          </div>
          {onApprove && (
            <Button size="sm" variant="secondary" onClick={() => onApprove(g.id)} icon={<Check className="size-4" aria-hidden />}>
              Approve
            </Button>
          )}
          {onDelete && (
            <button type="button" onClick={() => onDelete(g.id)} aria-label={`Remove ${g.source_term}`} className="flex size-11 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger">
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- Feedback ----------------------------------------------------------------

export function FeedbackSheet({
  target,
  onClose,
  token,
  roomId,
  config,
  speakerName,
}: {
  target: { u: Utterance; t: Translation | null } | null;
  onClose: () => void;
  token: string;
  roomId: string;
  config: PublicConfig | null;
  speakerName: string;
}) {
  const [suggestion, setSuggestion] = useState("");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSuggestion("");
    setTerm("");
    setDone(null);
    setError(null);
  }, [target]);
  if (!target) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const { u, t } = target;

  const send = async (kind: "incorrect" | "repeat") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "repeat" || !t) {
        await api.repeat(roomId, token, u.id);
        setDone(`${speakerName} has been asked to repeat.`);
      } else {
        await api.feedback(t.id, token, {
          feedback_type: "incorrect",
          suggested_text: suggestion.trim() || undefined,
          glossary_suggestion: term.trim() ? { source_term: term.trim() } : undefined,
        });
        setDone("Thanks. Your note is attached to this message and the speaker can see it.");
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Translation seems wrong?" description="Corrections are attached to the message; nothing is replaced silently.">
      <div className="space-y-4">
        <div className="rounded-2xl border border-line p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Original · {langName(config, u.source_language)}</p>
          <p lang={u.source_language ?? undefined} className="script-text mt-1 text-[16px]">{u.original_text}</p>
          {t?.translated_text && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Translation · {langName(config, t.target_language)}</p>
              <p lang={t.target_language} className="script-text mt-1 text-[16px]">{t.translated_text}</p>
              <p className="mt-2 text-xs text-muted">Translated by {t.provider}{t.latency_ms ? ` in ${(t.latency_ms / 1000).toFixed(1)}s` : ""}</p>
            </>
          )}
        </div>
        {done ? (
          <Notice tone="success" icon={<Check className="size-4" aria-hidden />}>{done}</Notice>
        ) : (
          <>
            <Button variant="secondary" className="w-full" onClick={() => send("repeat")} loading={busy === "repeat"} icon={<Repeat2 className="size-4" aria-hidden />}>
              Ask {speakerName} to say it again
            </Button>
            {t && (
              <div className="space-y-3 border-t border-line pt-4">
                <Field label="What do you think it means? (optional)" htmlFor="fb-text">
                  <textarea id="fb-text" value={suggestion} onChange={(e) => setSuggestion(e.target.value)} maxLength={600} rows={2} className="w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25" />
                </Field>
                <Field label="A name or term that was mistranslated (optional)" htmlFor="fb-term" hint="Sent to the room owner as a glossary suggestion.">
                  <Input id="fb-term" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} />
                </Field>
                <Button className="w-full" onClick={() => send("incorrect")} loading={busy === "incorrect"}>
                  Mark as incorrect
                </Button>
              </div>
            )}
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// --- Room settings (owner) / leave -----------------------------------------------

export function RoomSettingsSheet({
  open,
  onClose,
  room,
  token,
  isOwner,
  onLeave,
  onEnded,
}: {
  open: boolean;
  onClose: () => void;
  room: Room;
  token: string;
  isOwner: boolean;
  onLeave: () => Promise<void>;
  onEnded: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [retention, setRetention] = useState<RetentionMode>(room.transcript_retention_mode);
  const [voice, setVoice] = useState(room.voice_playback_enabled);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(room.name);
    setRetention(room.transcript_retention_mode);
    setVoice(room.voice_playback_enabled);
    setConfirmEnd(false);
    setError(null);
    api.usage(room.id, token).then(setUsage).catch(() => setUsage(null));
  }, [open, room, token]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={isOwner ? "Room settings" : "Room"}>
      <div className="space-y-6">
        {isOwner && (
          <section className="space-y-4">
            <Field label="Room name" htmlFor="rs-name">
              <Input id="rs-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Toggle id="rs-voice" checked={voice} onChange={setVoice} label="Translated voice" detail="Let participants hear translations read aloud." />
            <Segmented label="Transcript retention" value={retention} onChange={setRetention} options={(Object.keys(RETENTION_COPY) as RetentionMode[]).map((k) => ({ value: k, label: RETENTION_COPY[k].label }))} />
            <p className="-mt-2 text-sm text-muted">{RETENTION_COPY[retention].detail} Changing this notifies everyone in the room.</p>
            <Button
              variant="secondary"
              loading={busy === "save"}
              onClick={() => run("save", () => api.updateRoom(room.id, token, { name: name.trim() || room.name, voice_playback_enabled: voice, transcript_retention_mode: retention }).then(onClose))}
            >
              Save changes
            </Button>
          </section>
        )}

        {usage && (
          <section className="rounded-2xl bg-surface-2/70 p-4 text-sm">
            <p className="font-semibold">Usage in this room</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-ink-2">
              <dt>Your messages</dt>
              <dd className="text-right tabular-nums">{usage.utterances_by_me} / {usage.utterances_limit_per_participant}</dd>
              <dt>Server speech recognition</dt>
              <dd className="text-right tabular-nums">{Math.round(usage.audio_seconds_used)}s / {usage.audio_seconds_limit}s</dd>
              <dt>Translated characters</dt>
              <dd className="text-right tabular-nums">{usage.translate_chars_used.toLocaleString()} / {usage.translate_chars_limit.toLocaleString()}</dd>
            </dl>
          </section>
        )}

        <section className="space-y-3 border-t border-line pt-5">
          <p className="text-sm font-semibold">Your data</p>
          <Button variant="secondary" className="w-full" loading={busy === "mine"} onClick={() => run("mine", () => api.deleteHistory(room.id, token, "mine"))} icon={<Trash2 className="size-4" aria-hidden />}>
            Delete my messages from this room
          </Button>
          {isOwner && (
            <Button variant="secondary" className="w-full" loading={busy === "all"} onClick={() => run("all", () => api.deleteHistory(room.id, token, "room"))} icon={<Trash2 className="size-4" aria-hidden />}>
              Delete the whole transcript
            </Button>
          )}
        </section>

        <section className="space-y-3 border-t border-line pt-5">
          {!isOwner && (
            <Button variant="secondary" className="w-full" loading={busy === "leave"} onClick={() => run("leave", onLeave)}>
              Leave conversation
            </Button>
          )}
          {isOwner &&
            (confirmEnd ? (
              <Notice
                tone="danger"
                title="End for everyone?"
                action={
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="danger" loading={busy === "end"} onClick={() => run("end", () => api.endRoom(room.id, token).then(onEnded))}>End room</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>Cancel</Button>
                  </div>
                }
              >
                {room.transcript_retention_mode === "ephemeral"
                  ? "Everyone is disconnected and the transcript is deleted right away."
                  : `Everyone is disconnected. The transcript stays available to participants for ${room.transcript_retention_mode === "retain_24h" ? "24 hours" : "7 days"}, then is deleted.`}
              </Notice>
            ) : (
              <Button variant="danger" className="w-full" onClick={() => setConfirmEnd(true)}>
                End conversation for everyone
              </Button>
            ))}
        </section>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// --- Summary -----------------------------------------------------------------

export function SummaryPanel({ room, token, language, config }: { room: Room; token: string; language: string; config: PublicConfig | null }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.summary(room.id, token).then(setSummary).catch(() => undefined);
  }, [room.id, token]);
  if (!room.summaries_enabled) return null;
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.generateSummary(room.id, token, language));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const lists: [string, string[] | undefined][] = summary
    ? [
        ["Decisions", summary.action_items_json.decisions],
        ["Action items", summary.action_items_json.action_items],
        ["Open questions", summary.action_items_json.open_questions],
      ]
    : [];
  return (
    <section className="rounded-3xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> AI summary
        </h2>
        <Button size="sm" variant="secondary" onClick={generate} loading={busy} disabled={!config?.providers.summary}>
          {summary ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {!config?.providers.summary && <p className="mt-2 text-sm text-muted">Summaries need an AI provider configured on the server.</p>}
      {summary && (
        <div className="mt-3 space-y-3">
          <Badge tone="warning">AI-generated · check against the transcript below</Badge>
          <p className="leading-relaxed">{summary.summary}</p>
          {lists.map(([title, xs]) =>
            xs && xs.length ? (
              <div key={title}>
                <p className="text-sm font-semibold">{title}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            ) : null,
          )}
          <p className="text-xs text-muted">Generated by {summary.model_provider} at {new Date(summary.generated_at).toLocaleString()}</p>
        </div>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    </section>
  );
}
