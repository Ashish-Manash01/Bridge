"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { api, ApiError, wsUrl } from "@/lib/api";
import { TranslationPlayer, type PlayerState } from "@/lib/audio/player";
import { localeOf } from "@/lib/languages";
import { initialRoomState, roomReducer, type RoomState } from "@/lib/roomState";
import { sessions } from "@/lib/storage";
import type { Participant, PublicConfig, RoomEvent, Session, Translation } from "@/lib/types";

const PING_MS = 25_000;
const AUTOPLAY_MAX_AGE_MS = 30_000; // never autoplay stale audio after reconnect

export interface RoomController {
  state: RoomState;
  session: Session;
  me: Participant;
  player: TranslationPlayer;
  playerState: PlayerState;
  sendWs: (msg: Record<string, unknown>) => void;
  updateMe: (patch: Partial<Participant>) => Promise<void>;
  play: (t: Translation, now?: boolean) => void;
  retryConnection: () => void;
  dispatch: React.Dispatch<Parameters<typeof roomReducer>[1]>;
}

export function useRoom(initial: Session, config: PublicConfig | null): RoomController {
  const [session, setSession] = useState(initial);
  const [state, dispatch] = useReducer(roomReducer, undefined, () =>
    initialRoomState(initial.room, initial.participant),
  );
  const tokenRef = useRef(initial.token);
  tokenRef.current = session.token;
  const stateRef = useRef(state);
  stateRef.current = state;
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUs = useRef(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const player = useMemo(() => new TranslationPlayer(() => tokenRef.current), []);
  const [playerState, setPlayerState] = useState<PlayerState>({ status: "idle" });
  useEffect(() => {
    const unsub = player.subscribe(setPlayerState);
    return () => {
      unsub();
      player.stop();
    };
  }, [player]);

  const me = state.participants[state.meId] ?? session.participant;
  const meRef = useRef(me);
  meRef.current = me;
  const configRef = useRef(config);
  configRef.current = config;

  const play = useCallback(
    (t: Translation, now = false) => {
      if (!t.translated_text) return;
      const voiceServer = configRef.current?.providers.text_to_speech !== "browser";
      const item = {
        translationId: t.id,
        text: t.translated_text,
        locale: localeOf(configRef.current, t.target_language),
        source: voiceServer ? ("server" as const) : ("device" as const),
      };
      if (now) player.playNow(item);
      else player.enqueue(item);
    },
    [player],
  );

  const maybeAutoplay = useCallback(
    (event: RoomEvent) => {
      if (event.type !== "translation.ready") return;
      const t = event.payload as unknown as Translation;
      const m = meRef.current;
      const room = stateRef.current.room;
      if (!room?.voice_playback_enabled || m.audio_muted || m.output_mode === "captions") return;
      if (t.target_language !== m.preferred_language || event.participant_id === m.id) return;
      if (Date.now() - new Date(event.ts).getTime() > AUTOPLAY_MAX_AGE_MS) return;
      play(t);
    },
    [play],
  );

  // Token refresh at ~half-life.
  useEffect(() => {
    const ms = new Date(session.token_expires_at).getTime() - Date.now();
    const timer = setTimeout(async () => {
      try {
        const next = await api.refresh(session.room.id, session.token);
        sessions.set(next);
        setSession(next);
      } catch {
        /* the socket will report unauthorized if it really expired */
      }
    }, Math.max(10_000, ms / 2));
    return () => clearTimeout(timer);
  }, [session]);

  const gapFill = useCallback(async () => {
    try {
      const t = await api.transcript(session.room.id, tokenRef.current, 0);
      dispatch({ kind: "transcript", utterances: t.utterances });
    } catch {
      /* shown via connection state */
    }
  }, [session.room.id]);

  // WebSocket lifecycle with exponential backoff.
  useEffect(() => {
    let disposed = false;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    closedByUs.current = false;

    const connect = () => {
      if (disposed) return;
      dispatch({ kind: "connection", status: attemptRef.current ? "reconnecting" : "connecting" });
      const ws = new WebSocket(wsUrl(session.room.id, tokenRef.current));
      wsRef.current = ws;
      ws.onopen = () => {
        attemptRef.current = 0;
        void gapFill(); // fills anything missed while disconnected; merges are idempotent
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), PING_MS);
      };
      ws.onmessage = (msg) => {
        let event: RoomEvent;
        try {
          event = JSON.parse(msg.data as string);
        } catch {
          return;
        }
        dispatch({ kind: "event", event });
        maybeAutoplay(event);
        if (event.type === "room.ended") {
          player.stop();
        }
      };
      ws.onclose = (ev) => {
        clearInterval(pingTimer);
        if (disposed || closedByUs.current) return;
        if (ev.code === 4001) {
          dispatch({ kind: "connection", status: "ended" });
          return;
        }
        if (ev.code === 4401 || ev.code === 4403) {
          dispatch({ kind: "connection", status: "unauthorized" });
          return;
        }
        attemptRef.current += 1;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(attemptRef.current, 5)) + Math.random() * 400;
        dispatch({ kind: "connection", status: navigator.onLine === false ? "offline" : "reconnecting" });
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    const onOnline = () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        clearTimeout(retryTimer);
        attemptRef.current = 1;
        connect();
      }
    };
    const onOffline = () => dispatch({ kind: "connection", status: "offline" });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      disposed = true;
      closedByUs.current = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      wsRef.current?.close();
    };
    // Reconnect only when the room or an explicit retry changes, not on token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.room.id, reconnectNonce]);

  const sendWs = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const updateMe = useCallback(
    async (patch: Partial<Participant>) => {
      const prev = meRef.current;
      dispatch({ kind: "participant", participant: { ...prev, ...patch } }); // optimistic
      try {
        const updated = await api.updateMe(session.room.id, tokenRef.current, patch);
        dispatch({ kind: "participant", participant: { ...updated, online: true } });
        const stored = sessions.get(session.room.id);
        if (stored) sessions.set({ ...stored, participant: updated });
      } catch (err) {
        dispatch({ kind: "participant", participant: prev });
        throw err instanceof ApiError ? err : new Error("Couldn't save your preferences.");
      }
    },
    [session.room.id],
  );

  const retryConnection = useCallback(() => {
    attemptRef.current = 0;
    setReconnectNonce((n) => n + 1);
  }, []);

  return { state, session, me, player, playerState, sendWs, updateMe, play, retryConnection, dispatch };
}
