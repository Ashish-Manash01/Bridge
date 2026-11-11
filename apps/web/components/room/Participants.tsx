"use client";

import clsx from "clsx";
import { Crown, Mic, VolumeX } from "lucide-react";

import { langName, nativeName } from "@/lib/languages";
import type { Participant, PublicConfig } from "@/lib/types";

const PALETTE = ["#0b6b67", "#6a4cff", "#c2620f", "#2f6fd0", "#b03a6a", "#3f8a2e", "#8f6a00", "#7a3fc4"];

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ p, size = 36, speaking }: { p: Pick<Participant, "id" | "display_name">; size?: number; speaking?: boolean }) {
  const initials = p.display_name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {speaking && <span className="animate-pulse-ring absolute -inset-1 rounded-full bg-live" aria-hidden />}
      <span
        aria-hidden
        className="relative flex size-full items-center justify-center rounded-full font-semibold text-white"
        style={{ background: colorFor(p.id), fontSize: size * 0.38 }}
      >
        {initials || "?"}
      </span>
    </span>
  );
}

export function ParticipantList({
  participants,
  meId,
  speaking,
  config,
}: {
  participants: Participant[];
  meId: string;
  speaking: string[];
  config: PublicConfig | null;
}) {
  const sorted = [...participants].sort((a, b) => Number(b.id === meId) - Number(a.id === meId) || a.joined_at.localeCompare(b.joined_at));
  return (
    <ul className="space-y-1" aria-label="Participants">
      {sorted.map((p) => {
        const isSpeaking = speaking.includes(p.id);
        return (
          <li key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar p={p} speaking={isSpeaking} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                {p.display_name}
                {p.id === meId && <span className="font-normal text-muted">(you)</span>}
                {p.role === "owner" && <Crown className="size-3.5 text-warning" aria-label="Room owner" />}
              </p>
              <p className="truncate text-xs text-muted">
                <span className="script-text">{nativeName(config, p.preferred_language)}</span>
                {nativeName(config, p.preferred_language) !== langName(config, p.preferred_language) && ` · ${langName(config, p.preferred_language)}`}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {isSpeaking ? (
                <span className="inline-flex items-center gap-1 font-semibold text-live-ink">
                  <Mic className="size-3.5" aria-hidden /> Speaking
                </span>
              ) : p.audio_muted ? (
                <VolumeX className="size-3.5 text-muted" aria-label="Voice muted" />
              ) : null}
              <span
                className={clsx("size-2 rounded-full", p.online ? "bg-success" : "bg-line-strong")}
                aria-label={p.online ? "Online" : "Offline"}
                title={p.online ? "Online" : "Offline"}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
