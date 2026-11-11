import type {
  GlossaryEntry,
  OutputMode,
  Participant,
  PublicConfig,
  RetentionMode,
  Room,
  RoomPreview,
  Session,
  Summary,
  Transcript,
  Translation,
  Usage,
  Utterance,
} from "./types";

/** Resolves the API origin.
 *  - NEXT_PUBLIC_API_URL when set (separate API host)
 *  - Next dev server on :3000 → same host on :8000 (works from phones on the LAN)
 *  - otherwise same origin (API serves the static export) */
export function apiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window === "undefined") return "";
  const { protocol, hostname, port, origin } = window.location;
  if (port === "3000") return `${protocol}//${hostname}:8000`;
  return origin;
}

export function wsUrl(roomId: string, token: string): string {
  const base = apiOrigin() || window.location.origin;
  return `${base.replace(/^http/, "ws")}/ws/rooms/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: { field: string; message: string }[] = [],
    public retryAfter?: number,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

const FRIENDLY: Record<string, string> = {
  rate_limited: "You're going a little fast. Please wait a moment and try again.",
  room_not_found: "We couldn't find a conversation with that code.",
  room_closed: "This conversation has ended.",
  room_full: "This conversation is full.",
  token_expired: "Your session expired. Please join again.",
};

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "Can't reach BRIDGE. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const d = body?.detail;
    const code = typeof d === "object" && d?.code ? d.code : `http_${res.status}`;
    const message =
      (typeof d === "object" && d?.message) || FRIENDLY[code] || (typeof d === "string" ? d : "Something went wrong.");
    throw new ApiError(res.status, code, FRIENDLY[code] ?? message, d?.errors ?? [], d?.retry_after);
  }
  return body as T;
}

export interface JoinPrefs {
  display_name: string;
  preferred_language: string;
  spoken_language?: string | null;
  output_mode: OutputMode;
  consent: boolean;
}

export const api = {
  config: () => request<PublicConfig>("/api/config"),
  createRoom: (
    body: JoinPrefs & {
      name?: string;
      topic?: string;
      transcript_retention_mode: RetentionMode;
      voice_playback_enabled: boolean;
      summaries_enabled: boolean;
      allowed_languages?: string[];
    },
  ) => request<Session>("/api/rooms", { method: "POST", body: JSON.stringify(body) }),
  preview: (code: string) => request<RoomPreview>(`/api/rooms/preview/${encodeURIComponent(code)}`),
  joinRoom: (body: JoinPrefs & { join_code: string }) =>
    request<Session>("/api/rooms/join", { method: "POST", body: JSON.stringify(body) }),
  refresh: (roomId: string, token: string) =>
    request<Session>(`/api/rooms/${roomId}/token/refresh`, { method: "POST", token }),
  room: (roomId: string, token: string) => request<Room>(`/api/rooms/${roomId}`, { token }),
  updateRoom: (roomId: string, token: string, body: Partial<Room>) =>
    request<Room>(`/api/rooms/${roomId}`, { method: "PATCH", token, body: JSON.stringify(body) }),
  participants: (roomId: string, token: string) =>
    request<Participant[]>(`/api/rooms/${roomId}/participants`, { token }),
  updateMe: (roomId: string, token: string, body: Partial<Participant>) =>
    request<Participant>(`/api/rooms/${roomId}/participants/me`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    }),
  sendText: (
    roomId: string,
    token: string,
    body: {
      idempotency_key: string;
      text: string;
      input_mode: "text" | "voice_browser";
      source_language?: string;
      recognition_confidence?: number | null;
      audio_duration_ms?: number;
    },
  ) => request<Utterance>(`/api/rooms/${roomId}/utterances`, { method: "POST", token, body: JSON.stringify(body) }),
  sendAudio: (roomId: string, token: string, wav: Blob, idempotencyKey: string, sourceLanguage?: string) => {
    const form = new FormData();
    form.append("audio", wav, "utterance.wav");
    form.append("idempotency_key", idempotencyKey);
    if (sourceLanguage) form.append("source_language", sourceLanguage);
    return request<Utterance>(`/api/rooms/${roomId}/utterances/audio`, { method: "POST", token, body: form });
  },
  translateOne: (roomId: string, token: string, utteranceId: string, target: string) =>
    request<Translation>(
      `/api/rooms/${roomId}/utterances/${utteranceId}/translations?target_language=${encodeURIComponent(target)}`,
      { method: "POST", token },
    ),
  transcript: (roomId: string, token: string, afterSeq = 0) =>
    request<Transcript>(`/api/rooms/${roomId}/transcript?after_seq=${afterSeq}&limit=500`, { token }),
  feedback: (
    translationId: string,
    token: string,
    body: {
      feedback_type: "incorrect" | "unclear" | "repeat_request" | "helpful";
      suggested_text?: string;
      glossary_suggestion?: { source_term: string; preferred_translation?: string };
    },
  ) => request(`/api/translations/${translationId}/feedback`, { method: "POST", token, body: JSON.stringify(body) }),
  repeat: (roomId: string, token: string, utteranceId: string) =>
    request(`/api/rooms/${roomId}/utterances/${utteranceId}/repeat`, { method: "POST", token }),
  glossary: (roomId: string, token: string) => request<GlossaryEntry[]>(`/api/rooms/${roomId}/glossary`, { token }),
  addGlossary: (
    roomId: string,
    token: string,
    body: { source_term: string; preferred_translation?: string | null; note?: string | null },
  ) => request<GlossaryEntry>(`/api/rooms/${roomId}/glossary`, { method: "POST", token, body: JSON.stringify(body) }),
  approveGlossary: (roomId: string, token: string, id: string) =>
    request<GlossaryEntry>(`/api/rooms/${roomId}/glossary/${id}/approve`, { method: "POST", token }),
  deleteGlossary: (roomId: string, token: string, id: string) =>
    request<void>(`/api/rooms/${roomId}/glossary/${id}`, { method: "DELETE", token }),
  endRoom: (roomId: string, token: string) => request<Room>(`/api/rooms/${roomId}/end`, { method: "POST", token }),
  leave: (roomId: string, token: string) => request<void>(`/api/rooms/${roomId}/leave`, { method: "POST", token }),
  deleteHistory: (roomId: string, token: string, scope: "room" | "mine") =>
    request<{ deleted_utterances: number }>(`/api/rooms/${roomId}/history?scope=${scope}`, {
      method: "DELETE",
      token,
    }),
  usage: (roomId: string, token: string) => request<Usage>(`/api/rooms/${roomId}/usage`, { token }),
  summary: (roomId: string, token: string) => request<Summary | null>(`/api/rooms/${roomId}/summary`, { token }),
  generateSummary: (roomId: string, token: string, language: string) =>
    request<Summary>(`/api/rooms/${roomId}/summary`, { method: "POST", token, body: JSON.stringify({ language }) }),
  translationAudio: async (translationId: string, token: string): Promise<Blob> => {
    let res: Response;
    try {
      res = await fetch(`${apiOrigin()}/api/translations/${translationId}/audio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new ApiError(0, "network", "Audio couldn't be loaded.");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.detail?.code ?? `http_${res.status}`, body?.detail?.message ?? "Audio unavailable.");
    }
    return res.blob();
  },
};

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
