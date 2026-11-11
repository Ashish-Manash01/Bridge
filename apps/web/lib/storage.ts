import type { OutputMode, Session } from "./types";

// Browser storage can be unavailable (private mode, blocked site data), so
// every access is guarded and the app works without it.

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

// Guest sessions: short-lived, room-scoped tokens. Kept so a page refresh or
// brief disconnect doesn't force re-joining.
export const sessions = {
  get(roomId: string): Session | null {
    const s = read<Session>(`bridge.session.${roomId}`);
    if (!s) return null;
    if (new Date(s.token_expires_at).getTime() < Date.now()) {
      write(`bridge.session.${roomId}`, null);
      return null;
    }
    return s;
  },
  set(session: Session) {
    write(`bridge.session.${session.room.id}`, session);
    const recent = read<string[]>("bridge.recent") ?? [];
    write("bridge.recent", [session.room.id, ...recent.filter((id) => id !== session.room.id)].slice(0, 5));
  },
  clear(roomId: string) {
    write(`bridge.session.${roomId}`, null);
  },
  recent(): Session[] {
    return (read<string[]>("bridge.recent") ?? []).map((id) => sessions.get(id)).filter((s): s is Session => !!s);
  },
};

export interface Prefs {
  display_name: string;
  preferred_language: string;
  output_mode: OutputMode;
}

export const prefs = {
  get: (): Partial<Prefs> => read<Partial<Prefs>>("bridge.prefs") ?? {},
  set: (p: Partial<Prefs>) => write("bridge.prefs", { ...prefs.get(), ...p }),
};
