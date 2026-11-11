"use client";

import { DoorOpen, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { FullPageMessage } from "@/components/common";
import { RoomView } from "@/components/room/RoomView";
import { useConfig } from "@/hooks/useConfig";
import { sessions } from "@/lib/storage";
import type { Session } from "@/lib/types";

function RoomInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { config } = useConfig();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => setSession(id ? sessions.get(id) : null), [id]);

  if (session === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted" role="status">
        <Loader2 className="mr-2 size-5 animate-spin" aria-hidden /> Opening room…
      </div>
    );
  }
  if (!session) {
    return (
      <FullPageMessage
        icon={<DoorOpen className="size-6" aria-hidden />}
        title="Join this conversation first"
        actions={<Link href="/join" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-ink">Enter a room code</Link>}
      >
        We couldn&apos;t find your guest pass for this room on this device. Ask for the invite link or code to join.
      </FullPageMessage>
    );
  }
  return <RoomView initial={session} config={config} justCreated={params.get("new") === "1"} />;
}

export default function RoomPage() {
  return (
    <Suspense>
      <RoomInner />
    </Suspense>
  );
}
