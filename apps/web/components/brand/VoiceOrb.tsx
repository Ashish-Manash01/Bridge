"use client";

export type OrbState = "idle" | "listening" | "processing" | "disabled";

/**
 * Voice orb: morphing rings around a gradient core that breathe at rest and
 * swell with the live microphone level while listening. Inspired by the
 * 21st.dev "Voice Orb" pattern, rebuilt in pure CSS (compositor-only
 * transforms, no script animation loop) so it stays smooth and battery-friendly
 * on phones. Decorative only: the hosting button carries the accessible name.
 */
export function VoiceOrb({
  state,
  level = 0,
  size = 96,
}: {
  state: OrbState;
  level?: number;
  size?: number;
  /** Kept for API compatibility; reduced motion is handled in CSS. */
  reducedMotion?: boolean;
}) {
  const lvl = state === "listening" ? Math.min(1, level * 1.4) : state === "processing" ? 0.3 : 0;
  return (
    <span
      aria-hidden
      className="orb pointer-events-none"
      data-state={state}
      style={{ width: size, height: size, ["--lvl" as string]: lvl.toFixed(3) }}
    >
      <span className="orb-glow" />
      <span className="orb-ring orb-r1" />
      <span className="orb-ring orb-r2" />
      <span className="orb-ring orb-r3" />
      <span className="orb-core" />
    </span>
  );
}
