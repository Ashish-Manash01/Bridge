"""WebSocket endpoint for live room events.

Clients connect to /ws/rooms/{room_id}?token=<guest token>. Browsers cannot
set headers on WebSocket requests, so the token travels in the query string;
uvicorn access logs are disabled to keep it out of logs (core/logging.py).
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import TokenError, decode_guest_token
from app.db.session import SessionLocal
from app.models import Room, RoomParticipant, utcnow
from app.realtime.hub import emit, hub
from app.schemas.events import ClientMessage, EventEnvelope
from app.services.rooms import is_expired, participant_out, room_out

log = logging.getLogger("bridge.ws")
router = APIRouter()

# Close codes (4xxx are application-defined)
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_ROOM_ENDED = 4001


@router.websocket("/ws/rooms/{room_id}")
async def room_socket(ws: WebSocket, room_id: str) -> None:
    token = ws.query_params.get("token", "")
    try:
        claims = decode_guest_token(token)
    except TokenError:
        await ws.close(code=CLOSE_UNAUTHORIZED)
        return
    if claims.room_id != room_id:
        await ws.close(code=CLOSE_FORBIDDEN)
        return

    async with SessionLocal() as db:
        room = await db.get(Room, room_id)
        me = await db.get(RoomParticipant, claims.participant_id)
        if not room or not me or me.room_id != room_id or me.left_at is not None:
            await ws.close(code=CLOSE_FORBIDDEN)
            return
        if room.status != "active" or is_expired(room):
            await ws.close(code=CLOSE_ROOM_ENDED)
            return
        await ws.accept()
        first = await hub.connect(room_id, me.id, ws)
        me.last_seen_at = utcnow()
        await db.commit()
        participants = (await db.execute(select(RoomParticipant).where(
            RoomParticipant.room_id == room_id, RoomParticipant.left_at.is_(None)
        ).order_by(RoomParticipant.joined_at))).scalars().all()
        online = hub.online_ids(room_id)
        await hub.send_to(ws, EventEnvelope(type="room.snapshot", room_id=room_id, participant_id=me.id, payload={
            "room": room_out(room).model_dump(mode="json"),
            "participants": [participant_out(p, online).model_dump(mode="json") for p in participants],
            "speaking": [],
            "last_sequence": room.next_sequence - 1,
        }))
        await hub.send_to(ws, EventEnvelope(type="connection.status", room_id=room_id, payload={"status": "connected"}))
    if first:
        await emit("participant.presence", room_id, participant_id=me.id, payload={"online": True})

    max_s = get_settings().max_utterance_seconds
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 2048:
                continue
            try:
                msg = ClientMessage.model_validate(json.loads(raw))
            except (ValidationError, json.JSONDecodeError):
                await hub.send_to(ws, EventEnvelope(type="error", room_id=room_id,
                                                    payload={"code": "invalid_message"}))
                continue
            if msg.type == "ping":
                await hub.send_to(ws, EventEnvelope(type="pong", room_id=room_id))
            elif msg.type == "floor.request":
                others = hub.take_floor(room_id, me.id, max_s)
                await emit("utterance.started", room_id, participant_id=me.id,
                           payload={"speaker_name": me.display_name, "overlap_with": others})
                if others:
                    await hub.send_to(ws, EventEnvelope(type="floor.busy", room_id=room_id, payload={
                        "speaking": others,
                        "message": "Someone else is speaking. Taking turns keeps translations clear.",
                    }))
            elif msg.type == "floor.release":
                if hub.release_floor(room_id, me.id):
                    await emit("utterance.stopped", room_id, participant_id=me.id)
            elif msg.type in ("playback.started", "playback.stopped"):
                await emit(msg.type, room_id, participant_id=me.id, utterance_id=msg.utterance_id)
    except WebSocketDisconnect:
        pass
    finally:
        was_speaking = hub.release_floor(room_id, me.id)
        gone = await hub.disconnect(room_id, me.id, ws)
        if was_speaking:
            await emit("utterance.stopped", room_id, participant_id=me.id)
        if gone:
            await emit("participant.presence", room_id, participant_id=me.id, payload={"online": False})
            async with SessionLocal() as db:
                p = await db.get(RoomParticipant, me.id)
                if p:
                    p.last_seen_at = utcnow()
                    await db.commit()
