"""Short-lived guest access tokens and join-code generation."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import get_settings

# No 0/O, 1/I/L, to keep codes easy to read aloud and type.
JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 6  # 31^6 ≈ 887M combinations; joins are also rate limited per IP.

ALGORITHM = "HS256"


def generate_join_code() -> str:
    return "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))


def normalize_join_code(raw: str) -> str:
    return "".join(ch for ch in raw.upper() if ch.isalnum())


@dataclass(frozen=True)
class GuestClaims:
    participant_id: str
    room_id: str
    role: str
    expires_at: datetime


def issue_guest_token(participant_id: str, room_id: str, role: str) -> tuple[str, datetime]:
    s = get_settings()
    exp = datetime.now(UTC) + timedelta(minutes=s.guest_token_ttl_minutes)
    payload = {"sub": participant_id, "room": room_id, "role": role, "exp": exp, "typ": "guest"}
    return jwt.encode(payload, s.secret_key, algorithm=ALGORITHM), exp


class TokenError(Exception):
    pass


def decode_guest_token(token: str) -> GuestClaims:
    s = get_settings()
    try:
        data = jwt.decode(token, s.secret_key, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]})
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("token_invalid") from exc
    if data.get("typ") != "guest":
        raise TokenError("token_invalid")
    return GuestClaims(
        participant_id=data["sub"],
        room_id=data["room"],
        role=data.get("role", "participant"),
        expires_at=datetime.fromtimestamp(data["exp"], UTC),
    )
