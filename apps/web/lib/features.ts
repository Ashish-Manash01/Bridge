// Browser capability detection. Never assume every device supports the same
// audio APIs; the UI adapts and explains what's missing.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DeviceSupport {
  secureContext: boolean;
  microphone: boolean;
  audioWorklet: boolean;
  speechRecognition: boolean;
  speechSynthesis: boolean;
  audioPlayback: boolean;
}

export function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function detectSupport(): DeviceSupport {
  if (typeof window === "undefined") {
    return {
      secureContext: false,
      microphone: false,
      audioWorklet: false,
      speechRecognition: false,
      speechSynthesis: false,
      audioPlayback: false,
    };
  }
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  return {
    secureContext: window.isSecureContext,
    microphone: !!navigator.mediaDevices?.getUserMedia && window.isSecureContext,
    audioWorklet: !!AC && "audioWorklet" in AC.prototype,
    speechRecognition: !!getSpeechRecognitionCtor(),
    speechSynthesis: "speechSynthesis" in window,
    audioPlayback: typeof Audio !== "undefined",
  };
}

export function voicesFor(locale: string): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const base = locale.split("-")[0].toLowerCase();
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.replace("_", "-").toLowerCase().split("-")[0] === base)
    .sort((a, b) => Number(b.lang.toLowerCase() === locale.toLowerCase()) - Number(a.lang.toLowerCase() === locale.toLowerCase()));
}

/** Voices load asynchronously in Chrome; resolve once available (or after a short wait). */
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve([]);
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) return resolve(existing);
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
