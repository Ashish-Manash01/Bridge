"use client";

import { ArrowLeft, Download, FileText, Loader2, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { FullPageMessage, MockBanner, SiteHeader } from "@/components/common";
import { SummaryPanel } from "@/components/room/Sheets";
import { Badge, Button, Notice, Segmented } from "@/components/ui";
import { useConfig } from "@/hooks/useConfig";
import { api, ApiError } from "@/lib/api";
import { dirOf, langName } from "@/lib/languages";
import { sessions } from "@/lib/storage";
import type { Session, Transcript, Utterance } from "@/lib/types";

function textFor(u: Utterance, lang: string, view: "mine" | "original") {
  if (view === "original" || u.source_language === lang) return { text: u.original_text ?? "", lang: u.source_language };
  const t = u.translations.find((x) => x.target_language === lang);
  return t?.translated_text ? { text: t.translated_text, lang } : { text: u.original_text ?? "", lang: u.source_language };
}

function TranscriptInner() {
  const id = useSearchParams().get("id") ?? "";
  const { config } = useConfig();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [data, setData] = useState<Transcript | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"mine" | "original">("mine");

  useEffect(() => setSession(id ? sessions.get(id) : null), [id]);
  useEffect(() => {
    if (!session) return;
    api.transcript(session.room.id, session.token).then(setData).catch(setError);
  }, [session]);

  const lang = session?.participant.preferred_language ?? "en";
  const rows = useMemo(() => {
    const all = (data?.utterances ?? []).filter((u) => u.original_text);
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((u) =>
      [u.original_text, u.speaker_name, ...u.translations.map((t) => t.translated_text)].some((s) => s?.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  const exportFile = (format: "txt" | "md") => {
    if (!data) return;
    const lines = data.utterances
      .filter((u) => u.original_text)
      .map((u) => {
        const t = new Date(u.created_at).toLocaleTimeString();
        const main = textFor(u, lang, view);
        const orig = main.text !== u.original_text ? `(original, ${langName(config, u.source_language)}): ${u.original_text}` : "";
        return format === "md"
          ? `**${u.speaker_name}** · ${t}  \n${main.text}${orig ? `  \n_${orig}_` : ""}\n`
          : `[${t}] ${u.speaker_name}: ${main.text}${orig ? `\n    ${orig}` : ""}`;
      });
    const note = `Exported from BRIDGE on ${new Date().toLocaleString()}. Machine-translated into ${langName(config, lang)}; check originals for accuracy.`;
    const header = format === "md" ? `# ${data.room.name}\n\n${note}\n\n` : `${data.room.name}\n${note}\n\n`;
    const blob = new Blob([header + lines.join("\n")], { type: format === "md" ? "text/markdown" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bridge-transcript-${data.room.join_code}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (session === undefined) return null;
  if (!session) {
    return (
      <FullPageMessage
        icon={<FileText className="size-6" aria-hidden />}
        title="Transcript unavailable"
        actions={<Link href="/" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-ink">Go home</Link>}
      >
        Only people who joined this room can see its transcript, and your guest pass for it isn&apos;t on this device.
      </FullPageMessage>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
      <Link href={`/room?id=${session.room.id}`} className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back to room
      </Link>
      <h1 className="font-display text-3xl font-semibold">{data?.room.name ?? session.room.name}</h1>
      <p className="mt-1 text-muted">Transcript</p>

      {data && (
        <Notice tone="primary" className="mt-4" icon={<ShieldCheck className="size-4" aria-hidden />}>
          {data.retention_notice}
        </Notice>
      )}
      {error && <Notice tone="danger" className="mt-4">{error.message}</Notice>}

      <div className="mt-6 space-y-4">
        {data && <SummaryPanel room={data.room} token={session.token} language={lang} config={config} />}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative flex-1">
            <label htmlFor="search" className="sr-only">Search transcript</label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              id="search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search names, words…"
              className="h-12 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div className="sm:w-72">
            <Segmented
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: "mine", label: langName(config, lang) },
                { value: "original", label: "Originals" },
              ]}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportFile("txt")} icon={<Download className="size-4" aria-hidden />} disabled={!data?.utterances.length}>
            Export .txt
          </Button>
          <Button variant="secondary" size="sm" onClick={() => exportFile("md")} icon={<Download className="size-4" aria-hidden />} disabled={!data?.utterances.length}>
            Export .md
          </Button>
        </div>

        {!data && !error ? (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-muted">
            {q ? "No matches." : "Nothing has been said yet, or the transcript was deleted."}
          </p>
        ) : (
          <ol className="divide-y divide-line rounded-3xl border border-line bg-surface">
            {rows.map((u) => {
              const main = textFor(u, lang, view);
              const t = u.translations.find((x) => x.target_language === lang);
              return (
                <li key={u.id} className="px-5 py-4">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                    <span className="font-semibold text-ink">{u.speaker_name}</span>
                    <span>spoke {langName(config, u.source_language)}</span>
                    <time dateTime={u.created_at}>{new Date(u.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                    {view === "mine" && t?.quality_status === "uncertain" && <Badge tone="warning">uncertain</Badge>}
                    {view === "mine" && t?.quality_status === "failed" && <Badge tone="danger">translation failed</Badge>}
                  </p>
                  <p lang={main.lang ?? undefined} dir={dirOf(config, main.lang)} className="script-text mt-1 text-[16px]">
                    {main.text}
                  </p>
                  {view === "mine" && main.text !== u.original_text && (
                    <p lang={u.source_language ?? undefined} className="script-text mt-1 border-l-2 border-line-strong pl-2 text-sm text-muted">
                      {u.original_text}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </main>
  );
}

export default function TranscriptPage() {
  const { config } = useConfig();
  return (
    <>
      <MockBanner config={config} />
      <SiteHeader />
      <Suspense>
        <TranscriptInner />
      </Suspense>
    </>
  );
}
