"""Language capability matrix derived from the configured providers plus
BRIDGE's own evaluation results (app/core/evaluation_results.json, written by
scripts/evaluate_providers.py). The UI renders this; nothing is advertised as
"tested" unless an evaluation run recorded it."""

from __future__ import annotations

import json
from pathlib import Path

from app.core.config import get_settings
from app.core.languages import LANGUAGES
from app.providers.registry import providers

EVAL_FILE = Path(__file__).resolve().parent.parent / "core" / "evaluation_results.json"


def _evaluations() -> dict:
    """Evaluation results apply only to the provider combination they were run with."""
    try:
        data = json.loads(EVAL_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    p = providers()
    current = {
        "stt": p.stt.name if p.stt else "browser",
        "translation": p.translation.name,
        "tts": p.tts.name if p.tts else "browser",
    }
    return data if data.get("providers") == current else {}


def language_matrix() -> list[dict]:
    p = providers()
    evals = _evaluations().get("languages", {})
    rows = []
    for code in get_settings().enabled_language_codes:
        lang = LANGUAGES.get(code)
        if not lang:
            continue
        ev = evals.get(code, {})
        rows.append(
            {
                "code": code,
                "locale": lang.locale,
                "name": lang.name,
                "native_name": lang.native_name,
                "dir": lang.script_dir,
                # "device" means it depends on the participant's browser; the
                # client checks support before offering it.
                "speech_input": "device" if p.stt is None else ("server" if p.stt.supports(code) else "none"),
                "language_detection": bool(p.stt and p.stt.detects_language and p.stt.supports(code)),
                "translation": p.translation.supports(code),
                "speech_output": "device" if p.tts is None else ("server" if p.tts.supports(code) else "none"),
                "streaming": False,
                "tested": ev.get("status"),  # None | "automated_pass" | "human_reviewed" | "failed"
                "tested_at": ev.get("tested_at"),
                "tested_note": ev.get("note"),
            }
        )
    return rows


def public_config() -> dict:
    s = get_settings()
    p = providers()
    return {
        "environment": s.bridge_env,
        "mock_mode": s.uses_mock(),
        "providers": {
            "speech_to_text": p.stt.name if p.stt else "browser",
            "translation": p.translation.name,
            "translation_fallback": p.translation_fallback.name if p.translation_fallback else None,
            "text_to_speech": p.tts.name if p.tts else "browser",
            "summary": p.summary.name if p.summary else None,
        },
        "limits": {
            "max_utterance_seconds": s.max_utterance_seconds,
            "max_audio_bytes": s.max_audio_bytes,
            "max_text_chars": s.max_text_chars,
            "max_participants_per_room": s.max_participants_per_room,
            "room_ttl_hours": s.room_ttl_hours,
            "max_audio_seconds_per_room": s.max_audio_seconds_per_room,
        },
        "languages": language_matrix(),
        "retention_modes": ["ephemeral", "retain_24h", "retain_7d"],
    }
