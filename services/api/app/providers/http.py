"""Shared HTTP plumbing for provider adapters: one pooled client and a
uniform mapping from transport failures to ProviderError codes."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.providers.base import ProviderError

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(get_settings().provider_timeout_seconds, connect=5.0),
            headers={"User-Agent": "BRIDGE/1.0 (+https://github.com/)"},
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def request(method: str, url: str, **kwargs: Any) -> httpx.Response:
    try:
        resp = await client().request(method, url, **kwargs)
    except httpx.TimeoutException as exc:
        raise ProviderError("provider_timeout", "The provider took too long to respond.", retryable=True) from exc
    except httpx.HTTPError as exc:
        raise ProviderError("provider_unreachable", "Could not reach the provider.", retryable=True) from exc
    if resp.status_code == 429:
        if "quota" in resp.text or "credit" in resp.text:
            raise ProviderError("provider_quota", "The provider account is out of credits or quota.")
        raise ProviderError("provider_rate_limited", "The provider is rate limiting requests.", retryable=True)
    if resp.status_code in (401, 403):
        raise ProviderError("provider_auth", "Provider credentials were rejected. Check the server configuration.")
    if resp.status_code >= 500:
        raise ProviderError("provider_unavailable", "The provider is temporarily unavailable.", retryable=True)
    if resp.status_code >= 400:
        raise ProviderError("provider_rejected", f"The provider rejected the request ({resp.status_code}).")
    return resp


def require_key(value: str, env_name: str) -> str:
    if not value:
        raise ProviderError("provider_not_configured", f"{env_name} is not set on the server.")
    return value
