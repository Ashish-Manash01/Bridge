import { concatFloat32, downsample, encodeWav } from "./wav";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MicErrorCode = "permission_denied" | "no_microphone" | "mic_in_use" | "insecure_context" | "unsupported" | "unknown";

export class MicError extends Error {
  constructor(public code: MicErrorCode, message: string) {
    super(message);
  }
}

export function toMicError(err: unknown): MicError {
  if (err instanceof MicError) return err;
  const name = (err as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new MicError("permission_denied", "Microphone access was blocked. You can allow it in your browser's site settings, or type instead.");
    case "NotFoundError":
    case "OverconstrainedError":
      return new MicError("no_microphone", "No microphone was found on this device. You can type instead.");
    case "NotReadableError":
    case "AbortError":
      return new MicError("mic_in_use", "Your microphone is busy, possibly in another app or call. Close it and try again.");
    default:
      return new MicError("unknown", "The microphone couldn't be started. Please try again.");
  }
}

export async function openMicrophone(): Promise<MediaStream> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new MicError("insecure_context", "Microphone needs a secure (https) connection.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicError("unsupported", "This browser can't capture audio. You can type instead.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    throw toMicError(err);
  }
}

export interface Recording {
  wav: Blob;
  durationMs: number;
  peak: number;
}

/**
 * Captures one utterance as 16 kHz mono WAV. WAV (rather than MediaRecorder's
 * webm/mp4) behaves identically on Android, iOS and desktop and is accepted by
 * every speech provider adapter.
 */
export class UtteranceRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private peak = 0;
  private lastLevelAt = 0;
  private levelMax = 0;
  /** Called at most ~20 times per second (not per audio frame) to keep React renders cheap. */
  onLevel?: (level: number) => void;

  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC() as AudioContext;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(stream);
    const handle = (frame: Float32Array) => {
      this.chunks.push(frame);
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      const rms = Math.sqrt(sum / frame.length);
      this.peak = Math.max(this.peak, rms);
      this.levelMax = Math.max(this.levelMax, rms);
      const now = performance.now();
      if (now - this.lastLevelAt > 50) {
        this.lastLevelAt = now;
        this.onLevel?.(Math.min(1, this.levelMax * 6));
        this.levelMax = 0;
      }
    };
    try {
      if (!this.ctx.audioWorklet) throw new Error("no worklet");
      await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
      const node = new AudioWorkletNode(this.ctx, "pcm-capture");
      node.port.onmessage = (e) => handle(e.data as Float32Array);
      this.node = node;
    } catch {
      // Older Safari: ScriptProcessor fallback.
      const node = this.ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
      this.node = node;
    }
    this.source.connect(this.node);
    // Some browsers only pull audio through nodes connected to the destination.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
    this.startedAt = performance.now();
  }

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  async stop(): Promise<Recording> {
    const rate = this.ctx?.sampleRate ?? 48000;
    const durationMs = this.elapsedMs;
    this.teardown();
    const pcm = downsample(concatFloat32(this.chunks), rate, 16000);
    this.chunks = [];
    return { wav: encodeWav(pcm, 16000), durationMs, peak: this.peak };
  }

  cancel(): void {
    this.teardown();
    this.chunks = [];
  }

  private teardown() {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.stream?.getTracks().forEach((t) => t.stop()); // releases the mic indicator immediately
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}
