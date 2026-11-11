// Pure room state reducer: one canonical event stream, merged idempotently.
// Events may arrive late, twice (after reconnect gap-fill) or out of order;
// every merge is keyed by utterance id / target language so the result is the
// same regardless.

import type { Participant, Room, RoomEvent, Translation, Utterance } from "./types";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "ended" | "unauthorized";

export interface FeedbackNotice {
  id: string;
  utteranceId: string;
  fromName: string;
  type: string;
  suggestedText: string | null;
  at: string;
}

export interface RoomState {
  room: Room | null;
  meId: string;
  participants: Record<string, Participant>;
  utterances: Record<string, Utterance>;
  speaking: string[];
  connection: ConnectionStatus;
  lastSeq: number;
  floorBusy: string | null;
  notices: FeedbackNotice[];
  glossaryVersion: number;
  endedReason: string | null;
}

export type RoomAction =
  | { kind: "event"; event: RoomEvent }
  | { kind: "transcript"; utterances: Utterance[] }
  | { kind: "connection"; status: ConnectionStatus }
  | { kind: "participant"; participant: Participant }
  | { kind: "room"; room: Room }
  | { kind: "localUtterance"; utterance: Utterance }
  | { kind: "translation"; translation: Translation }
  | { kind: "dismissNotice"; id: string }
  | { kind: "clearFloorBusy" };

export function initialRoomState(room: Room | null, me: Participant | null): RoomState {
  return {
    room,
    meId: me?.id ?? "",
    participants: me ? { [me.id]: me } : {},
    utterances: {},
    speaking: [],
    connection: "connecting",
    lastSeq: 0,
    floorBusy: null,
    notices: [],
    glossaryVersion: room?.glossary_version ?? 0,
    endedReason: null,
  };
}

function better(a: Translation | undefined, b: Translation): boolean {
  if (!a) return true;
  if (a.id === b.id) return true;
  if (a.quality_status === "failed" && b.quality_status !== "failed") return true;
  if (b.quality_status === "failed" && a.quality_status !== "failed") return false;
  return new Date(b.created_at).getTime() >= new Date(a.created_at).getTime();
}

export function mergeTranslation(u: Utterance, t: Translation): Utterance {
  const existing = u.translations.find((x) => x.target_language === t.target_language);
  if (!better(existing, t)) return u;
  return { ...u, translations: [...u.translations.filter((x) => x.target_language !== t.target_language), t] };
}

const STATUS_RANK: Record<string, number> = {
  processing: 0,
  transcribed: 1,
  partial: 2,
  translation_failed: 2,
  complete: 3,
  failed: 3,
};

export function mergeUtterance(prev: Utterance | undefined, next: Utterance): Utterance {
  if (!prev) return next;
  let merged: Utterance = {
    ...prev,
    ...next,
    // never regress status or lose text when an older snapshot arrives late
    processing_status:
      (STATUS_RANK[next.processing_status] ?? 0) >= (STATUS_RANK[prev.processing_status] ?? 0)
        ? next.processing_status
        : prev.processing_status,
    original_text: next.original_text ?? prev.original_text,
    translations: prev.translations,
  };
  for (const t of next.translations) merged = mergeTranslation(merged, t);
  return merged;
}

function placeholder(e: RoomEvent): Utterance {
  const p = e.payload as Record<string, string>;
  return {
    id: e.utterance_id!,
    room_id: e.room_id,
    participant_id: e.participant_id ?? "",
    speaker_name: p.speaker_name ?? "",
    sequence_number: e.sequence_number ?? 0,
    input_mode: (p.input_mode as Utterance["input_mode"]) ?? "text",
    source_language: null,
    original_text: null,
    recognition_confidence: null,
    stt_provider: null,
    processing_status: "processing",
    error_code: null,
    created_at: p.created_at ?? e.ts,
    translations: [],
  };
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.kind) {
    case "connection":
      if (state.connection === "ended") return state;
      return { ...state, connection: action.status };
    case "participant":
      return { ...state, participants: { ...state.participants, [action.participant.id]: action.participant } };
    case "room":
      return { ...state, room: action.room };
    case "dismissNotice":
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
    case "clearFloorBusy":
      return { ...state, floorBusy: null };
    case "transcript": {
      const utterances = { ...state.utterances };
      let lastSeq = state.lastSeq;
      for (const u of action.utterances) {
        utterances[u.id] = mergeUtterance(utterances[u.id], u);
        lastSeq = Math.max(lastSeq, u.sequence_number);
      }
      return { ...state, utterances, lastSeq };
    }
    case "localUtterance": {
      const u = action.utterance;
      return {
        ...state,
        utterances: { ...state.utterances, [u.id]: mergeUtterance(state.utterances[u.id], u) },
        lastSeq: Math.max(state.lastSeq, u.sequence_number),
      };
    }
    case "translation": {
      const u = state.utterances[action.translation.utterance_id];
      if (!u) return state;
      return { ...state, utterances: { ...state.utterances, [u.id]: mergeTranslation(u, action.translation) } };
    }
    case "event":
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: RoomState, e: RoomEvent): RoomState {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "room.snapshot": {
      const participants: Record<string, Participant> = {};
      for (const x of p.participants as Participant[]) participants[x.id] = x;
      return { ...state, room: p.room as Room, participants, glossaryVersion: (p.room as Room).glossary_version };
    }
    case "connection.status":
      return { ...state, connection: "connected" };
    case "room.updated":
      return { ...state, room: p as unknown as Room };
    case "room.ended":
      return {
        ...state,
        connection: "ended",
        endedReason: (p.reason as string) ?? "ended",
        room: state.room ? { ...state.room, status: "ended" } : state.room,
        speaking: [],
      };
    case "participant.joined":
    case "participant.updated": {
      const part = p as unknown as Participant;
      const prev = state.participants[part.id];
      return {
        ...state,
        participants: { ...state.participants, [part.id]: { ...part, online: prev?.online ?? part.online } },
      };
    }
    case "participant.left": {
      const participants = { ...state.participants };
      delete participants[e.participant_id!];
      return { ...state, participants, speaking: state.speaking.filter((id) => id !== e.participant_id) };
    }
    case "participant.presence": {
      const prev = state.participants[e.participant_id!];
      if (!prev) return state;
      const online = Boolean(p.online);
      return {
        ...state,
        participants: { ...state.participants, [prev.id]: { ...prev, online } },
        speaking: online ? state.speaking : state.speaking.filter((id) => id !== prev.id),
      };
    }
    case "utterance.started":
      return e.participant_id && !state.speaking.includes(e.participant_id)
        ? { ...state, speaking: [...state.speaking, e.participant_id] }
        : state;
    case "utterance.stopped":
      return { ...state, speaking: state.speaking.filter((id) => id !== e.participant_id) };
    case "floor.busy": {
      const ids = (p.speaking as string[]) ?? [];
      const name = ids.map((id) => state.participants[id]?.display_name).filter(Boolean)[0] ?? "Someone";
      return { ...state, floorBusy: name };
    }
    case "utterance.processing": {
      if (!e.utterance_id) return state;
      const prev = state.utterances[e.utterance_id];
      const u = prev ?? placeholder(e);
      return {
        ...state,
        utterances: { ...state.utterances, [u.id]: u },
        lastSeq: Math.max(state.lastSeq, e.sequence_number ?? 0),
      };
    }
    case "utterance.transcribed": {
      const next = { ...(p as unknown as Utterance), recognition_uncertain: Boolean(p.recognition_uncertain) };
      return {
        ...state,
        utterances: { ...state.utterances, [next.id]: mergeUtterance(state.utterances[next.id], next) },
        lastSeq: Math.max(state.lastSeq, next.sequence_number),
      };
    }
    case "utterance.failed": {
      if (!e.utterance_id) return state;
      const u = state.utterances[e.utterance_id] ?? placeholder(e);
      return {
        ...state,
        utterances: {
          ...state.utterances,
          [u.id]: { ...u, processing_status: "failed", error_code: p.error_code as string, error_message: p.message as string },
        },
      };
    }
    case "utterance.deleted": {
      const scope = p.scope as string;
      const utterances = Object.fromEntries(
        Object.entries(state.utterances).filter(([, u]) => scope === "mine" && u.participant_id !== p.participant_id),
      );
      return { ...state, utterances };
    }
    case "translation.ready":
    case "translation.failed": {
      const t = p as unknown as Translation;
      const u = state.utterances[t.utterance_id] ?? placeholder({ ...e, utterance_id: t.utterance_id });
      return { ...state, utterances: { ...state.utterances, [u.id]: mergeTranslation(u, t) } };
    }
    case "translation.feedback": {
      if (p.speaker_participant_id !== state.meId || e.participant_id === state.meId) return state;
      if (state.notices.some((n) => n.id === (p.id as string))) return state;
      const notice: FeedbackNotice = {
        id: p.id as string,
        utteranceId: e.utterance_id!,
        fromName: (p.from_name as string) ?? "Someone",
        type: p.feedback_type as string,
        suggestedText: (p.suggested_text as string) ?? null,
        at: e.ts,
      };
      return { ...state, notices: [...state.notices, notice].slice(-4) };
    }
    case "glossary.updated":
      return { ...state, glossaryVersion: (p.glossary_version as number) ?? state.glossaryVersion + 1 };
    default:
      return state;
  }
}

export function orderedUtterances(state: RoomState): Utterance[] {
  return Object.values(state.utterances).sort((a, b) => a.sequence_number - b.sequence_number);
}
