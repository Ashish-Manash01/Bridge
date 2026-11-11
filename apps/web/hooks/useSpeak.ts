"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { BrowserRecognizer } from "@/lib/audio/browserStt";
import { MicError, openMicrophone, toMicError, UtteranceRecorder } from "@/lib/audio/recorder";
import type { Utterance } from "@/lib/types";

export type SpeakPhase = "idle" | "starting" | "recording" | "submitting" | "error";

interface Options {
  roomId: string;
  token: () => string;
  mode: "server" | "browser";
  locale: string;
  language: string;
  maxSeconds: number;
  onFloor: (taking: boolean) => void;
  onSubmitted: (u: Utterance) => void;
  onBeforeStart?: () => void;
}

export function useSpeak(opts: Options) {
  const [phase, setPhase] = useState<SpeakPhase>("idle");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [partial, setPartial] = useState("");
  const recorder = useRef<UtteranceRecorder | null>(null);
  const recognizer = useRef<BrowserRecognizer | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const autoStop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startedAt = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const clearTimers = () => {
    clearInterval(tick.current);
    clearTimeout(autoStop.current);
  };

  const fail = useCallback((code: string, message: string) => {
    clearTimers();
    setError({ code, message });
    setPhase("error");
    setLevel(0);
    optsRef.current.onFloor(false);
  }, []);

  const submit = useCallback(
    async (send: (key: string) => Promise<Utterance>) => {
      setPhase("submitting");
      const key = newIdempotencyKey();
      // Retries reuse the same idempotency key, so a flaky network can never duplicate an utterance.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const u = await send(key);
          optsRef.current.onSubmitted(u);
          setPhase("idle");
          setPartial("");
          return;
        } catch (err) {
          const e = err as ApiError;
          if (e instanceof ApiError && e.isNetwork && attempt < 2) {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            continue;
          }
          fail(e.code ?? "submit_failed", e.message ?? "Couldn't send your message.");
          return;
        }
      }
    },
    [fail],
  );

  const stop = useCallback(async () => {
    const o = optsRef.current;
    if (phaseRef.current !== "recording" && phaseRef.current !== "starting") return;
    clearTimers();
    setLevel(0);
    o.onFloor(false);

    if (recognizer.current) {
      recognizer.current.stop();
      return; // the recognizer's promise resolves and submits
    }
    const rec = recorder.current;
    recorder.current = null;
    if (!rec) return setPhase("idle");
    const result = await rec.stop();
    if (result.durationMs < 500) return fail("too_short", "That was very short. Hold or tap Speak, then talk.");
    if (result.peak < 0.004) return fail("silent", "We didn't hear anything. Check that your microphone isn't muted.");
    await submit((key) => api.sendAudio(o.roomId, o.token(), result.wav, key, o.language));
  }, [fail, submit]);

  const start = useCallback(async () => {
    const o = optsRef.current;
    if (phaseRef.current === "recording" || phaseRef.current === "starting" || phaseRef.current === "submitting") return;
    setError(null);
    setPartial("");
    setPhase("starting");
    o.onBeforeStart?.();
    o.onFloor(true);
    startedAt.current = performance.now();
    const beginTimers = () => {
      setPhase("recording");
      startedAt.current = performance.now();
      tick.current = setInterval(() => setElapsed(performance.now() - startedAt.current), 200);
      autoStop.current = setTimeout(() => void stop(), o.maxSeconds * 1000);
    };

    if (o.mode === "browser") {
      const r = new BrowserRecognizer();
      recognizer.current = r;
      r.onPartial = setPartial;
      beginTimers();
      try {
        const res = await r.start(o.locale);
        recognizer.current = null;
        clearTimers();
        o.onFloor(false);
        setLevel(0);
        if (!res.text.trim()) return fail("no_speech", "No speech was recognised. Try again a little closer to the microphone.");
        await submit((key) =>
          api.sendText(o.roomId, o.token(), {
            idempotency_key: key,
            text: res.text.trim().slice(0, 600),
            input_mode: "voice_browser",
            source_language: o.language,
            recognition_confidence: res.confidence,
            audio_duration_ms: Math.round(res.durationMs),
          }),
        );
      } catch (err) {
        recognizer.current = null;
        const e = err instanceof MicError ? err : toMicError(err);
        fail(e.code, e.message);
      }
      return;
    }

    try {
      const stream = await openMicrophone();
      const rec = new UtteranceRecorder();
      rec.onLevel = setLevel;
      await rec.start(stream);
      recorder.current = rec;
      beginTimers();
    } catch (err) {
      const e = toMicError(err);
      fail(e.code, e.message);
    }
  }, [fail, stop, submit]);

  const cancel = useCallback(() => {
    clearTimers();
    recognizer.current?.abort();
    recognizer.current = null;
    recorder.current?.cancel();
    recorder.current = null;
    setLevel(0);
    setPartial("");
    optsRef.current.onFloor(false);
    setPhase("idle");
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    setPhase("idle");
  }, []);

  // Stop capturing if the tab is hidden: never record in the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      cancel();
    };
  }, [cancel]);

  return { phase, error, level, elapsed, partial, start, stop, cancel, dismissError };
}
