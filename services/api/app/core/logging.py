"""Structured, privacy-safe logging.

Never log transcript text, translations, glossary terms, display names or
tokens. Log identifiers, sizes, durations, providers and outcomes only.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

_TOKEN_RE = re.compile(r"(token=)[^&\s\"']+")


class RedactTokens(logging.Filter):
    """Strips guest tokens from log lines. Uvicorn logs WebSocket URLs (which
    carry ?token=) through `uvicorn.error`, separately from the access log."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if "token=" in msg:
            record.msg = _TOKEN_RE.sub(lambda m: m.group(1) + "[redacted]", msg)
            record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # Access logs include query strings (which may contain tokens on the WS URL).
    logging.getLogger("uvicorn.access").disabled = True
    redact = RedactTokens()
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", ""):
        logging.getLogger(name).addFilter(redact)
    handler.addFilter(redact)


def log_event(logger: logging.Logger, msg: str, **fields: object) -> None:
    logger.info(msg, extra={"fields": fields})
