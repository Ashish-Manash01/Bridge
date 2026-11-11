"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { MockBanner } from "@/components/common";
import { useConfig } from "@/hooks/useConfig";
import { sessions } from "@/lib/storage";
import type { Session } from "@/lib/types";

// Small client islands for the otherwise static (server-rendered) landing page.

export function LandingMockBanner() {
  const { config } = useConfig();
  return <MockBanner config={config} />;
}

export function ContinueRooms() {
  const [recent, setRecent] = useState<Session[]>([]);
  useEffect(() => setRecent(sessions.recent().filter((s) => s.room.status === "active")), []);
  if (!recent.length) return null;
  return (
    <div className="mt-8 max-w-md rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="px-2 text-xs font-semibold uppercase tracking-wider text-white/50">Continue</p>
      <ul className="mt-1">
        {recent.map((s) => (
          <li key={s.room.id}>
            <Link href={`/room?id=${s.room.id}`} className="flex items-center justify-between rounded-xl px-2 py-2.5 hover:bg-white/5">
              <span className="truncate font-medium">{s.room.name}</span>
              <span className="flex items-center gap-1 text-sm text-white/60">
                as {s.participant.display_name} <ArrowRight className="size-3.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
