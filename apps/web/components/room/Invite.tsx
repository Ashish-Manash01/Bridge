"use client";

import { Check, Copy, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import type { Room } from "@/lib/types";

export function joinLink(room: Room): string {
  const base = process.env.NEXT_PUBLIC_WEB_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/join?code=${room.join_code}`;
}

export function InvitePanel({ room, compact }: { room: Room; compact?: boolean }) {
  const link = joinLink(room);
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useEffect(() => {
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#14171c", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [link]);

  const copy = async (what: "link" | "code") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? link : room.join_code);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked: the text is visible to copy manually */
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `Join “${room.name}” on BRIDGE`, text: `Join our conversation on BRIDGE. Code ${room.join_code}`, url: link });
    } catch {
      /* cancelled */
    }
  };
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="space-y-4">
      <div className={`mx-auto rounded-2xl border border-line bg-white p-3 ${compact ? "w-40" : "w-56 sm:w-64"}`}>
        {svg ? (
          <div role="img" aria-label={`QR code to join ${room.name}`} className="[&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="aspect-square animate-pulse rounded-lg bg-surface-2" />
        )}
      </div>
      <div className="text-center">
        <p className="text-sm text-muted">Or enter code</p>
        <button
          type="button"
          onClick={() => copy("code")}
          className="mt-1 rounded-xl px-3 py-1 font-mono text-3xl font-semibold tracking-[0.3em] hover:bg-surface-2"
          aria-label={`Join code ${room.join_code.split("").join(" ")}. Copy code`}
        >
          {room.join_code}
        </button>
        <p className="h-5 text-xs text-success" aria-live="polite">
          {copied === "code" ? "Code copied" : copied === "link" ? "Link copied" : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => copy("link")} icon={copied === "link" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
          Copy link
        </Button>
        {canShare && (
          <Button variant="secondary" className="flex-1" onClick={share} icon={<Share2 className="size-4" aria-hidden />}>
            Share
          </Button>
        )}
      </div>
    </div>
  );
}
