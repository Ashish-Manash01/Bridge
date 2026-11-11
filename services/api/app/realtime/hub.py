"""In-memory room event hub (single API instance).

Fan-out is per room. For multiple API instances, replace the transport with
Redis pub/sub while keeping this interface (see docs/architecture.md).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field

from fastapi import WebSocket

from app.schemas.events import EventEnvelope

log = logging.getLogger("bridge.realtime")


@dataclass
class RoomChannel:
    sockets: dict[str, set[WebSocket]] = field(default_factory=lambda: defaultdict(set))
    # participant_id -> monotonic time the floor was taken
    speaking: dict[str, float] = field(default_factory=dict)


class Hub:
    def __init__(self) -> None:
        self._rooms: dict[str, RoomChannel] = defaultdict(RoomChannel)
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, participant_id: str, ws: WebSocket) -> bool:
        """Registers a socket. Returns True if this is the participant's first live socket."""
        async with self._lock:
            ch = self._rooms[room_id]
            first = not ch.sockets.get(participant_id)
            ch.sockets[participant_id].add(ws)
            return first

    async def disconnect(self, room_id: str, participant_id: str, ws: WebSocket) -> bool:
        """Returns True if the participant has no remaining live sockets."""
        async with self._lock:
            ch = self._rooms.get(room_id)
            if not ch:
                return True
            socks = ch.sockets.get(participant_id)
            if socks:
                socks.discard(ws)
                if not socks:
                    del ch.sockets[participant_id]
                    ch.speaking.pop(participant_id, None)
            if not ch.sockets:
                self._rooms.pop(room_id, None)
            return participant_id not in ch.sockets

    def online_ids(self, room_id: str) -> set[str]:
        ch = self._rooms.get(room_id)
        return set(ch.sockets) if ch else set()

    # --- Floor (turn-taking hint, not a hard lock) -------------------------
    def take_floor(self, room_id: str, participant_id: str, max_seconds: float) -> list[str]:
        """Marks participant as speaking; returns other participants already speaking."""
        ch = self._rooms[room_id]
        now = time.monotonic()
        for pid, started in list(ch.speaking.items()):
            if now - started > max_seconds + 5:
                ch.speaking.pop(pid, None)
        others = [pid for pid in ch.speaking if pid != participant_id]
        ch.speaking[participant_id] = now
        return others

    def release_floor(self, room_id: str, participant_id: str) -> bool:
        ch = self._rooms.get(room_id)
        return bool(ch and ch.speaking.pop(participant_id, None) is not None)

    # --- Delivery ----------------------------------------------------------
    async def broadcast(self, event: EventEnvelope, only: set[str] | None = None) -> None:
        ch = self._rooms.get(event.room_id)
        if not ch:
            return
        message = event.model_dump_json()
        targets = [
            (pid, ws) for pid, socks in list(ch.sockets.items()) if only is None or pid in only for ws in list(socks)
        ]
        await asyncio.gather(*(self._send(event.room_id, pid, ws, message) for pid, ws in targets))

    async def send_to(self, ws: WebSocket, event: EventEnvelope) -> None:
        await ws.send_text(event.model_dump_json())

    async def _send(self, room_id: str, pid: str, ws: WebSocket, message: str) -> None:
        try:
            await asyncio.wait_for(ws.send_text(message), timeout=5)
        except Exception:  # noqa: BLE001 - a dead socket must never break fan-out
            log.info("dropping socket", extra={"fields": {"room_id": room_id, "participant_id": pid}})
            await self.disconnect(room_id, pid, ws)

    async def close_room(self, room_id: str, code: int = 4000) -> None:
        ch = self._rooms.pop(room_id, None)
        if not ch:
            return
        for socks in ch.sockets.values():
            for ws in list(socks):
                try:
                    await ws.close(code=code)
                except Exception:  # noqa: BLE001
                    pass


hub = Hub()


async def emit(type_: str, room_id: str, *, only: set[str] | None = None, **kwargs) -> EventEnvelope:
    event = EventEnvelope(type=type_, room_id=room_id, **kwargs)  # type: ignore[arg-type]
    await hub.broadcast(event, only=only)
    return event
