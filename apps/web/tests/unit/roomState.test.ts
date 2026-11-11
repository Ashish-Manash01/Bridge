import { describe, expect, it } from "vitest";

import { initialRoomState, orderedUtterances, roomReducer, type RoomState } from "@/lib/roomState";
import type { Participant, Room, RoomEvent, Translation, Utterance } from "@/lib/types";

const room: Room = {
  id: "r1",
  join_code: "ABC234",
  name: "Test",
  topic: null,
  status: "active",
  transcript_retention_mode: "ephemeral",
  voice_playback_enabled: true,
  summaries_enabled: false,
  allowed_languages: ["en", "kn", "hi"],
  max_participants: 12,
  glossary_version: 0,
  owner_participant_id: "p1",
  created_at: "2026-01-01T00:00:00Z",
  expires_at: "2026-01-01T06:00:00Z",
  ended_at: null,
};
const me: Participant = {
  id: "p2",
  display_name: "Ravi",
  preferred_language: "kn",
  spoken_language: "kn",
  output_mode: "captions",
  audio_muted: false,
  role: "participant",
  joined_at: "2026-01-01T00:00:00Z",
  left_at: null,
  online: true,
};

function ev(type: RoomEvent["type"], payload: Record<string, unknown>, extra: Partial<RoomEvent> = {}): RoomEvent {
  return { type, event_id: Math.random().toString(36), room_id: "r1", ts: "2026-01-01T00:00:01Z", participant_id: null, utterance_id: null, sequence_number: null, payload, ...extra };
}

const utt = (over: Partial<Utterance> = {}): Utterance => ({
  id: "u1",
  room_id: "r1",
  participant_id: "p1",
  speaker_name: "Asha",
  sequence_number: 1,
  input_mode: "text",
  source_language: "en",
  original_text: "Hello",
  recognition_confidence: null,
  stt_provider: null,
  processing_status: "transcribed",
  error_code: null,
  created_at: "2026-01-01T00:00:01Z",
  translations: [],
  ...over,
});

const tr = (over: Partial<Translation> = {}): Translation => ({
  id: "t1",
  utterance_id: "u1",
  target_language: "kn",
  translated_text: "ನಮಸ್ಕಾರ",
  provider: "mock",
  quality_status: "translated",
  quality_note: null,
  glossary_terms: [],
  latency_ms: 10,
  created_at: "2026-01-01T00:00:02Z",
  ...over,
});

function run(actions: Parameters<typeof roomReducer>[1][], start?: RoomState) {
  return actions.reduce(roomReducer, start ?? initialRoomState(room, me));
}

describe("roomReducer", () => {
  it("builds one canonical utterance from processing → transcribed → translation events", () => {
    const s = run([
      { kind: "event", event: ev("utterance.processing", { speaker_name: "Asha" }, { utterance_id: "u1", participant_id: "p1", sequence_number: 1 }) },
      { kind: "event", event: ev("utterance.transcribed", utt() as unknown as Record<string, unknown>, { utterance_id: "u1" }) },
      { kind: "event", event: ev("translation.ready", tr() as unknown as Record<string, unknown>, { utterance_id: "u1" }) },
    ]);
    const list = orderedUtterances(s);
    expect(list).toHaveLength(1);
    expect(list[0].original_text).toBe("Hello");
    expect(list[0].translations.map((t) => t.target_language)).toEqual(["kn"]);
  });

  it("is idempotent when the same events arrive twice (reconnect gap-fill)", () => {
    const events = [
      { kind: "event" as const, event: ev("utterance.transcribed", utt() as unknown as Record<string, unknown>) },
      { kind: "event" as const, event: ev("translation.ready", tr() as unknown as Record<string, unknown>) },
    ];
    const once = run(events);
    const twice = run([...events, ...events, { kind: "transcript", utterances: [utt({ translations: [tr()] })] }]);
    expect(orderedUtterances(twice)).toEqual(orderedUtterances(once));
  });

  it("handles a translation arriving before its utterance (out of order)", () => {
    const s = run([
      { kind: "event", event: ev("translation.ready", tr() as unknown as Record<string, unknown>, { utterance_id: "u1", sequence_number: 1 }) },
      { kind: "event", event: ev("utterance.transcribed", utt() as unknown as Record<string, unknown>) },
    ]);
    const [u] = orderedUtterances(s);
    expect(u.original_text).toBe("Hello");
    expect(u.translations).toHaveLength(1);
  });

  it("never regresses status or loses text when an older snapshot arrives late", () => {
    const s = run([
      { kind: "transcript", utterances: [utt({ processing_status: "complete", translations: [tr()] })] },
      { kind: "event", event: ev("utterance.transcribed", utt({ processing_status: "transcribed", original_text: null }) as unknown as Record<string, unknown>) },
    ]);
    const [u] = orderedUtterances(s);
    expect(u.processing_status).toBe("complete");
    expect(u.original_text).toBe("Hello");
  });

  it("a successful retry replaces a failed translation, but a late failure never replaces success", () => {
    const failed = tr({ id: "t0", translated_text: null, quality_status: "failed", created_at: "2026-01-01T00:00:01Z" });
    let s = run([{ kind: "transcript", utterances: [utt({ translations: [failed] })] }]);
    s = roomReducer(s, { kind: "translation", translation: tr() });
    expect(orderedUtterances(s)[0].translations[0].quality_status).toBe("translated");
    s = roomReducer(s, { kind: "translation", translation: { ...failed, id: "t9", created_at: "2026-01-01T00:00:09Z" } });
    expect(orderedUtterances(s)[0].translations[0].quality_status).toBe("translated");
  });

  it("orders the feed by sequence number", () => {
    const s = run([{ kind: "transcript", utterances: [utt({ id: "b", sequence_number: 2 }), utt({ id: "a", sequence_number: 1 })] }]);
    expect(orderedUtterances(s).map((u) => u.id)).toEqual(["a", "b"]);
    expect(s.lastSeq).toBe(2);
  });

  it("tracks who is speaking and shows a take-turns notice", () => {
    let s = run([
      { kind: "event", event: ev("room.snapshot", { room, participants: [me, { ...me, id: "p1", display_name: "Asha" }] }) },
      { kind: "event", event: ev("utterance.started", {}, { participant_id: "p1" }) },
    ]);
    expect(s.speaking).toEqual(["p1"]);
    s = roomReducer(s, { kind: "event", event: ev("floor.busy", { speaking: ["p1"] }) });
    expect(s.floorBusy).toBe("Asha");
    s = roomReducer(s, { kind: "event", event: ev("utterance.stopped", {}, { participant_id: "p1" }) });
    expect(s.speaking).toEqual([]);
  });

  it("only notifies the speaker about feedback on their own messages", () => {
    const s = run([
      { kind: "event", event: ev("translation.feedback", { id: "f1", speaker_participant_id: "p2", feedback_type: "repeat_request", from_name: "Asha" }, { participant_id: "p1", utterance_id: "u1" }) },
      { kind: "event", event: ev("translation.feedback", { id: "f2", speaker_participant_id: "p9", feedback_type: "incorrect", from_name: "Asha" }, { participant_id: "p1", utterance_id: "u2" }) },
    ]);
    expect(s.notices.map((n) => n.id)).toEqual(["f1"]);
  });

  it("marks the room ended and stays ended", () => {
    let s = run([{ kind: "event", event: ev("room.ended", { reason: "ended_by_owner" }) }]);
    expect(s.connection).toBe("ended");
    s = roomReducer(s, { kind: "connection", status: "reconnecting" });
    expect(s.connection).toBe("ended");
  });

  it("removes deleted history according to scope", () => {
    const base = run([{ kind: "transcript", utterances: [utt({ id: "a", participant_id: "p1" }), utt({ id: "b", participant_id: "p2", sequence_number: 2 })] }]);
    const mine = roomReducer(base, { kind: "event", event: ev("utterance.deleted", { scope: "mine", participant_id: "p2" }) });
    expect(orderedUtterances(mine).map((u) => u.id)).toEqual(["a"]);
    const all = roomReducer(base, { kind: "event", event: ev("utterance.deleted", { scope: "room", participant_id: "p1" }) });
    expect(orderedUtterances(all)).toEqual([]);
  });
});
