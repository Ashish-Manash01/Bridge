"""In-process sliding-window rate limiter.

Adequate for a single API instance. For horizontal scaling, swap for a
Redis-backed limiter with the same interface (see docs/architecture.md).
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: float) -> None:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= limit:
            retry = max(1, int(window_seconds - (now - q[0])))
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "rate_limited", "message": "Too many requests. Please slow down.", "retry_after": retry},
                headers={"Retry-After": str(retry)},
            )
        q.append(now)

    def reset(self) -> None:
        self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Only trust X-Forwarded-For when deployed behind a proxy you control
    # (uvicorn --proxy-headers sets request.client accordingly).
    return request.client.host if request.client else "unknown"
