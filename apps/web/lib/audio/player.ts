import { api } from "../api";
import { loadVoices, voicesFor } from "../features";

export type PlaybackSource = "server" | "device";

export interface PlaybackItem {
  translationId: string;
  text: string;
  locale: string;
  source: PlaybackSource;
}

export type PlayerState =
  | { status: "idle" }
  | { status: "playing"; translationId: string }
  | { status: "error"; translationId: string; message: string };

const MAX_QUEUE = 3; // never queue unbounded audio

/**
 * Per-participant playback queue: one utterance at a time, no overlap,
 * bounded, stoppable. Server audio is fetched on demand; device voices are the
 * fallback. Captions always remain available if playback fails.
 */
export class TranslationPlayer {
  private queue: PlaybackItem[] = [];
  private audio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private current: PlaybackItem | null = null;
  private listeners = new Set<(s: PlayerState) => void>();
  private state: PlayerState = { status: "idle" };
  private unlocked = false;

  constructor(private getToken: () => string) {}

  subscribe(fn: (s: PlayerState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(s: PlayerState) {
    this.state = s;
    this.listeners.forEach((fn) => fn(s));
  }

  /** Call from a user gesture (join / first tap) so iOS allows later playback. */
  unlock() {
    if (this.unlocked || typeof window === "undefined") return;
    this.unlocked = true;
    try {
      this.audio = new Audio();
      this.audio.setAttribute("playsinline", "");
      this.audio.muted = true;
      this.audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
      void this.audio.play().catch(() => undefined).finally(() => {
        if (this.audio) this.audio.muted = false;
      });
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* best effort */
    }
  }

  enqueue(item: PlaybackItem) {
    if (this.current?.translationId === item.translationId || this.queue.some((q) => q.translationId === item.translationId)) return;
    this.queue.push(item);
    while (this.queue.length > MAX_QUEUE) this.queue.shift(); // drop oldest
    if (!this.current) void this.next();
  }

  /** Replay immediately, interrupting the queue. */
  playNow(item: PlaybackItem) {
    this.stop();
    this.queue = [item];
    void this.next();
  }

  stop() {
    this.queue = [];
    this.current = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
    }
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.set({ status: "idle" });
  }

  private async next(): Promise<void> {
    const item = this.queue.shift();
    if (!item) {
      this.current = null;
      this.set({ status: "idle" });
      return;
    }
    this.current = item;
    this.set({ status: "playing", translationId: item.translationId });
    try {
      if (item.source === "server") {
        try {
          await this.playServer(item);
        } catch (err) {
          // Server voice unavailable: fall back to the device voice if there is one.
          if (!(await this.hasDeviceVoice(item.locale))) throw err;
          await this.playDevice(item);
        }
      } else {
        await this.playDevice(item);
      }
      if (this.current !== item) return; // stopped meanwhile
      void this.next();
    } catch (err) {
      if (this.current !== item) return;
      this.current = null;
      this.set({ status: "error", translationId: item.translationId, message: (err as Error).message });
      setTimeout(() => {
        if (!this.current) void this.next();
      }, 50);
    }
  }

  private async playServer(item: PlaybackItem) {
    const blob = await api.translationAudio(item.translationId, this.getToken());
    if (this.current !== item) return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.setAttribute("playsinline", "");
    }
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = URL.createObjectURL(blob);
    const audio = this.audio;
    audio.src = this.currentUrl;
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("This device couldn't play the translated audio."));
      audio.play().catch(() => reject(new Error("Playback was blocked. Tap replay to listen.")));
    });
  }

  private async hasDeviceVoice(locale: string) {
    await loadVoices();
    return voicesFor(locale).length > 0;
  }

  private async playDevice(item: PlaybackItem) {
    if (!("speechSynthesis" in window)) throw new Error("This browser can't speak translations. Captions are shown instead.");
    await loadVoices();
    const voices = voicesFor(item.locale);
    if (!voices.length) throw new Error("No voice for this language on this device. Captions are shown instead.");
    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = item.locale;
      u.voice = voices[0];
      u.rate = 1;
      u.onend = () => resolve();
      u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error("Voice playback failed.")));
      window.speechSynthesis.speak(u);
    });
  }
}
