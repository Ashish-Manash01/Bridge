import { describe, expect, it } from "vitest";

import { toMicError } from "@/lib/audio/recorder";
import { concatFloat32, downsample, encodeWav } from "@/lib/audio/wav";

describe("wav encoding", () => {
  it("downsamples 48 kHz to 16 kHz", () => {
    const input = new Float32Array(48000).fill(0.5);
    const out = downsample(input, 48000, 16000);
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(0.5);
  });

  it("writes a valid 16-bit mono WAV header", async () => {
    const blob = encodeWav(new Float32Array(1600), 16000);
    const view = new DataView(await blob.arrayBuffer());
    const text = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(blob.size).toBe(44 + 1600 * 2);
  });

  it("clips out-of-range samples instead of overflowing", async () => {
    const blob = encodeWav(new Float32Array([2, -2]), 16000);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("concatenates chunks in order", () => {
    expect(Array.from(concatFloat32([new Float32Array([1, 2]), new Float32Array([3])]))).toEqual([1, 2, 3]);
  });
});

describe("microphone errors", () => {
  it.each([
    ["NotAllowedError", "permission_denied"],
    ["NotFoundError", "no_microphone"],
    ["NotReadableError", "mic_in_use"],
    ["Weird", "unknown"],
  ])("maps %s to %s with a helpful message", (name, code) => {
    const e = toMicError({ name });
    expect(e.code).toBe(code);
    expect(e.message.length).toBeGreaterThan(20);
  });
});
