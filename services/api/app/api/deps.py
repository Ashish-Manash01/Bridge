"""Authentication and room-membership dependencies. Every room read and write
goes through `member()` or `active_member()`."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import GuestClaims, TokenError, decode_guest_token
from app.db.session import get_db
from app.models import Room, RoomParticipant
from app.services.rooms import is_expired


def http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, detail={"code": code, "message": message})


@dataclass
class Membership:
    claims: GuestClaims
    room: Room
    participant: RoomParticipant

    @property
    def is_owner(self) -> bool:
        return self.participant.role == "owner"


def bearer_claims(authorization: str | None = Header(default=None)) -> GuestClaims:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise http_error(status.HTTP_401_UNAUTHORIZED, "auth_required", "Join the room to continue.")
    try:
        return decode_guest_token(authorization.split(" ", 1)[1].strip())
    except TokenError as exc:
        raise http_error(status.HTTP_401_UNAUTHORIZED, str(exc), "Your room session is no longer valid.") from exc


async def load_membership(db: AsyncSession, claims: GuestClaims, room_id: str) -> Membership:
    if claims.room_id != room_id:
        raise http_error(status.HTTP_403_FORBIDDEN, "not_a_member", "You are not a member of this room.")
    participant = await db.get(RoomParticipant, claims.participant_id)
    room = await db.get(Room, room_id)
    if not room or not participant or participant.room_id != room.id:
        raise http_error(status.HTTP_404_NOT_FOUND, "room_not_found", "This room no longer exists.")
    if participant.left_at is not None:
        raise http_error(status.HTTP_403_FORBIDDEN, "left_room", "You left this room. Join again to continue.")
    return Membership(claims, room, participant)


async def member(
    room_id: str = Path(max_length=32),
    claims: GuestClaims = Depends(bearer_claims),
    db: AsyncSession = Depends(get_db),
) -> Membership:
    return await load_membership(db, claims, room_id)


async def active_member(m: Membership = Depends(member)) -> Membership:
    if m.room.status != "active" or is_expired(m.room):
        raise http_error(status.HTTP_410_GONE, "room_closed", "This conversation has ended.")
    return m


async def owner(m: Membership = Depends(member)) -> Membership:
    if not m.is_owner:
        raise http_error(status.HTTP_403_FORBIDDEN, "owner_only", "Only the room owner can do that.")
    return m
