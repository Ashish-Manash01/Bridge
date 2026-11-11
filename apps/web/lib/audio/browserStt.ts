import { getSpeechRecognitionCtor } from "../features";
import { MicError } from "./recorder";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BrowserSttResult {
  text: string;
  confidence: number | null;
  durationMs: number;
}

/**
 * On-device/browser speech recognition (Web Speech API). In Chrome, audio is
 * processed by Google's speech service; in Safari, by Apple. The UI states
 * this before the participant speaks.
 */
export class BrowserRecognizer {
  private rec: any = null;
  private finalText = "";
  private interim = "";
  private confidences: number[] = [];
  private startedAt = 0;
  private resolve?: (r: BrowserSttResult) => void;
  private reject?: (e: Error) => void;
  private stopped = false;
  onPartial?: (text: string) => void;

  static supported(): boolean {
    return !!getSpeechRecognitionCtor();
  }

  start(locale: string): Promise<BrowserSttResult> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return Promise.reject(new MicError("unsupported", "Speech recognition isn't available in this browser."));
    this.rec = new Ctor();
    this.rec.lang = locale;
    this.rec.interimResults = true;
    this.rec.continuous = true;
    this.rec.maxAlternatives = 1;
    this.startedAt = performance.now();

    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.rec.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) {
            this.finalText += (this.finalText ? " " : "") + r[0].transcript.trim();
            if (typeof r[0].confidence === "number" && r[0].confidence > 0) this.confidences.push(r[0].confidence);
          } else {
            interim += r[0].transcript;
          }
        }
        this.interim = interim;
        this.onPartial?.(`${this.finalText} ${interim}`.trim());
      };
      this.rec.onerror = (event: any) => {
        const code = event.error as string;
        if (code === "no-speech" || code === "aborted") return; // handled on end
        const map: Record<string, MicError> = {
          "not-allowed": new MicError("permission_denied", "Microphone access was blocked. Allow it in site settings, or type instead."),
          "service-not-allowed": new MicError("permission_denied", "Speech recognition is blocked in this browser. You can type instead."),
          "audio-capture": new MicError("no_microphone", "No microphone was found. You can type instead."),
          network: new MicError("unknown", "Speech recognition needs an internet connection. Check your connection and try again."),
          "language-not-supported": new MicError("unsupported", "This browser can't recognise speech in your language. You can type instead."),
        };
        this.finish(map[code] ?? new MicError("unknown", "Speech recognition stopped unexpectedly."));
      };
      this.rec.onend = () => {
        // Chrome may end on its own after silence; treat as completion.
        this.finish();
      };
      try {
        this.rec.start();
      } catch (e) {
        this.finish(new MicError("unknown", (e as Error).message));
      }
    });
  }

  /** Stop listening and resolve with what was recognised. */
  stop() {
    this.stopped = true;
    try {
      this.rec?.stop();
    } catch {
      this.finish();
    }
  }

  abort() {
    this.stopped = true;
    this.resolve = undefined;
    this.reject = undefined;
    try {
      this.rec?.abort();
    } catch {
      /* noop */
    }
  }

  private finish(error?: Error) {
    const resolve = this.resolve;
    const reject = this.reject;
    this.resolve = this.reject = undefined;
    if (error) return reject?.(error);
    // Safari sometimes leaves the last result interim when stopped.
    const text = `${this.finalText} ${this.stopped ? this.interim : ""}`.trim();
    const confidence = this.confidences.length
      ? this.confidences.reduce((a, b) => a + b, 0) / this.confidences.length
      : null;
    resolve?.({ text, confidence, durationMs: performance.now() - this.startedAt });
  }
}
