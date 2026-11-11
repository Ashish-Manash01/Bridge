"use client";

import { Pause, Play } from "lucide-react";
import { useState } from "react";

/** Pause/resume for the landing page's auto-playing animations (WCAG 2.2.2). */
export function MotionToggle() {
  const [paused, setPaused] = useState(false);
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    document.documentElement.dataset.motion = next ? "paused" : "";
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={paused}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white/70 hover:bg-white/5 hover:text-white"
    >
      {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
      {paused ? "Play animation" : "Pause animation"}
    </button>
  );
}
