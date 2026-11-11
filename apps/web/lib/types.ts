// Mirrors services/api/app/schemas. Keep in sync with docs/api.md.

export type OutputMode = "captions" | "audio" | "both";
export type RetentionMode = "ephemeral" | "retain_24h" | "retain_7d";
export type QualityStatus = "translated" | "uncertain" | "failed";
export type ProcessingStatus =
  | "processing"
  | "transcribed"
  | "complete"
  | "partial"
  | "translation_failed"
  | "failed";

export interface LanguageCapability {
  code: string;
  locale: string;
  name: string;
  native_name: string;
  dir: "ltr" | "rtl";
  speech_input: "server" | "device" | "none";
  language_detection: boolean;
  translation: boolean;
  speech_output: "server" | "device" | "none";
  streaming: boolean;
  tested: null | "automated_pass" | "human_reviewed" | "failed";
  tested_at: string | null;
  tested_note: string | null;
}

export interface PublicConfig {
  environment: string;
  mock_mode: boolean;
  providers: {
    speech_to_text: string;
    translation: string;
    translation_fallback: string | null;
    text_to_speech: string;
    summary: string | null;
  };
  limits: {
    max_utterance_seconds: number;
    max_audio_bytes: number;
    max_text_chars: number;
    max_participants_per_room: number;
    room_ttl_hours: number;
    max_audio_seconds_per_room: number;
  };
  languages: LanguageCapability[];
  retention_modes: RetentionMode[];
}

export interface Room {
  id: string;
  join_code: string;
  name: string;
  topic: string | null;
  status: "active" | "ended";
  transcript_retention_mode: RetentionMode;
  voice_playback_enabled: boolean;
  summaries_enabled: boolean;
  allowed_languages: string[];
  max_participants: number;
  glossary_version: number;
  owner_participant_id: string | null;
  created_at: string;
  expires_at: string;
  ended_at: string | null;
}

export interface RoomPreview {
  name: string;
  status: "active" | "ended";
  participant_count: number;
  languages_in_use: string[];
  allowed_languages: string[];
  transcript_retention_mode: RetentionMode;
  summaries_enabled: boolean;
  voice_playback_enabled: boolean;
  full: boolean;
}

export interface Participant {
  id: string;
  display_name: string;
  preferred_language: string;
  spoken_language: string | null;
  output_mode: OutputMode;
  audio_muted: boolean;
  role: "owner" | "participant";
  joined_at: string;
  left_at: string | null;
  online: boolean;
}

export interface Session {
  token: string;
  token_expires_at: string;
  room: Room;
  participant: Participant;
}

export interface Translation {
  id: string;
  utterance_id: string;
  target_language: string;
  translated_text: string | null;
  provider: string;
  quality_status: QualityStatus;
  quality_note: string | null;
  glossary_terms: string[];
  latency_ms: number | null;
  created_at: string;
}

export interface Utterance {
  id: string;
  room_id: string;
  participant_id: string;
  speaker_name: string;
  sequence_number: number;
  input_mode: "voice_server" | "voice_browser" | "text";
  source_language: string | null;
  original_text: string | null;
  recognition_confidence: number | null;
  stt_provider: string | null;
  processing_status: ProcessingStatus;
  error_code: string | null;
  created_at: string;
  translations: Translation[];
  // client-only
  recognition_uncertain?: boolean;
  error_message?: string;
}

export interface Transcript {
  room: Room;
  utterances: Utterance[];
  retention_notice: string;
}

export interface GlossaryEntry {
  id: string;
  source_term: string;
  preferred_translation: string | null;
  source_language: string | null;
  target_language: string | null;
  note: string | null;
  status: "approved" | "suggested";
  created_by: string | null;
  created_at: string;
}

export interface Summary {
  id: string;
  language: string;
  summary: string;
  action_items_json: { decisions?: string[]; action_items?: string[]; open_questions?: string[] };
  generated_at: string;
  model_provider: string;
}

export interface Usage {
  audio_seconds_used: number;
  audio_seconds_limit: number;
  translate_chars_used: number;
  translate_chars_limit: number;
  utterances_by_me: number;
  utterances_limit_per_participant: number;
  estimated_cost_usd: number;
}

export type EventType =
  | "connection.status"
  | "room.snapshot"
  | "room.updated"
  | "room.ended"
  | "participant.joined"
  | "participant.updated"
  | "participant.left"
  | "participant.presence"
  | "utterance.started"
  | "utterance.stopped"
  | "utterance.processing"
  | "utterance.transcribed"
  | "utterance.failed"
  | "utterance.deleted"
  | "translation.ready"
  | "translation.failed"
  | "translation.feedback"
  | "playback.started"
  | "playback.stopped"
  | "glossary.updated"
  | "summary.ready"
  | "floor.busy"
  | "error"
  | "pong";

export interface RoomEvent<P = Record<string, unknown>> {
  type: EventType;
  event_id: string;
  room_id: string;
  ts: string;
  participant_id: string | null;
  utterance_id: string | null;
  sequence_number: number | null;
  payload: P;
}
