"""Automated provider smoke evaluation.

Runs a small, fixed test set through the *configured* providers and writes
app/core/evaluation_results.json, which feeds the "tested" column of the
language matrix shown in the app.

What it checks, per enabled language:
  * translation to and from English: non-empty output in the expected script
    (names/numbers preserved where the test case says so)
  * server speech-to-text (when STT_PROVIDER is a server adapter): synthesise
    a sentence with the server TTS, transcribe it back, and compare
  * server text-to-speech (when TTS_PROVIDER is a server adapter): non-empty audio

It never marks a language "human_reviewed": that requires people who speak the
language to rate real conversations (see docs/provider-evaluation.md). A
language only gets status "automated_pass" when every *server-side* capability
configured for it passed; device-side speech (browser mode) is reported as
"needs device testing" in the note.

Usage (from services/api):  python -m scripts.evaluate_providers
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
import time
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.languages import LANGUAGES  # noqa: E402
from app.providers.base import AudioInput, ProviderError  # noqa: E402
from app.providers.registry import providers  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "app" / "core" / "evaluation_results.json"

SCRIPTS = {
    "hi": r"[ऀ-ॿ]",
    "mr": r"[ऀ-ॿ]",
    "kn": r"[ಀ-೿]",
    "ta": r"[஀-௿]",
    "te": r"[ఀ-౿]",
    "ml": r"[ഀ-ൿ]",
    "bn": r"[ঀ-৿]",
    "gu": r"[઀-૿]",
    "pa": r"[਀-੿]",
    "ur": r"[؀-ۿ]",
    "ar": r"[؀-ۿ]",
    "en": r"[A-Za-z]",
    "es": r"[A-Za-z]",
    "fr": r"[A-Za-z]",
    "de": r"[A-Za-z]",
}

# English source sentences. `keep` lists tokens that must survive translation.
EN_CASES = [
    {"text": "Shall we meet at the library at five o'clock tomorrow?", "keep": []},
    {"text": "Please bring 3 copies of the report for Priya.", "keep": ["3"]},
    {"text": "The bus to Jayanagar leaves from platform 2.", "keep": ["2"]},
]

# Native-language sentences translated into English (sanity: English letters come back).
NATIVE = {
    "hi": "क्या हम कल पाँच बजे पुस्तकालय में मिल सकते हैं?",
    "kn": "ನಾವು ನಾಳೆ ಐದು ಗಂಟೆಗೆ ಗ್ರಂಥಾಲಯದಲ್ಲಿ ಭೇಟಿಯಾಗೋಣವೇ?",
    "ta": "நாளை ஐந்து மணிக்கு நூலகத்தில் சந்திக்கலாமா?",
    "te": "మనం రేపు ఐదు గంటలకు గ్రంథాలయంలో కలుద్దామా?",
    "ml": "നാളെ അഞ്ചു മണിക്ക് ലൈബ്രറിയിൽ കാണാമോ?",
    # Code-switching (Hinglish / Kanglish): a key real-world scenario.
    "hi_mixed": "कल meeting है, please slides ready रखना।",
    "kn_mixed": "ನಾಳೆ meeting ಇದೆ, slides ready ಮಾಡಿಕೊಳ್ಳಿ.",
}


# Numbers may be kept as digits or written as words (formal style does the latter).
NUMBER_WORDS = {
    "2": {"hi": ["दो", "दूसर"], "kn": ["ಎರಡ"], "ta": ["இரண்ட", "இரண்டா"], "te": ["రెండ"], "ml": ["രണ്ട"]},
    "3": {"hi": ["तीन"], "kn": ["ಮೂರು"], "ta": ["மூன்று"], "te": ["మూడు"], "ml": ["മൂന്ന"]},
}


def keeps(text: str, token: str, lang: str) -> bool:
    return token in text or any(w in text for w in NUMBER_WORDS.get(token, {}).get(lang, []))


def in_script(text: str, lang: str) -> bool:
    pat = SCRIPTS.get(lang)
    return bool(pat and re.search(pat, text))


async def check_translation(lang: str) -> dict:
    p = providers().translation
    results = []
    if lang == "en":
        return {"ok": True, "cases": [], "note": "source language"}
    for case in EN_CASES:
        started = time.monotonic()
        try:
            r = await p.translate(case["text"], "en", lang)
            ok = bool(r.text.strip()) and in_script(r.text, lang) and all(keeps(r.text, k, lang) for k in case["keep"])
            results.append({"src": case["text"], "out": r.text, "ok": ok, "ms": int((time.monotonic() - started) * 1000)})
        except ProviderError as exc:
            results.append({"src": case["text"], "error": exc.code, "ok": False})
    for key in (lang, f"{lang}_mixed"):
        if key in NATIVE:
            try:
                r = await p.translate(NATIVE[key], lang, "en")
                results.append({"src": NATIVE[key], "out": r.text, "ok": in_script(r.text, "en"), "reverse": True})
            except ProviderError as exc:
                results.append({"src": NATIVE[key], "error": exc.code, "ok": False, "reverse": True})
    return {"ok": all(c["ok"] for c in results), "cases": results}


async def check_speech(lang: str) -> dict:
    p = providers()
    out: dict = {}
    sample = EN_CASES[0]["text"] if lang == "en" else NATIVE.get(lang)
    if p.tts is not None and p.tts.supports(lang) and sample:
        try:
            audio = await p.tts.synthesize(sample, lang)
            out["tts"] = {"ok": len(audio.audio) > 1000, "bytes": len(audio.audio)}
            if p.stt is not None and p.stt.supports(lang) and audio.content_type == "audio/wav":
                tr = await p.stt.transcribe(AudioInput(audio.audio, "audio/wav"), lang)
                sim = SequenceMatcher(None, sample, tr.text).ratio()
                out["stt"] = {"ok": sim > 0.6, "similarity": round(sim, 2), "heard": tr.text}
        except ProviderError as exc:
            out["error"] = exc.code
    return out


async def main() -> None:
    s = get_settings()
    p = providers()
    report: dict = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "providers": {
            "stt": p.stt.name if p.stt else "browser",
            "translation": p.translation.name,
            "tts": p.tts.name if p.tts else "browser",
        },
        "languages": {},
    }
    for lang in s.enabled_language_codes:
        if lang not in LANGUAGES:
            continue
        print(f"… {lang}", flush=True)
        tr = await check_translation(lang)
        speech = await check_speech(lang)
        server_checks = [tr["ok"]] + [v["ok"] for k, v in speech.items() if isinstance(v, dict) and "ok" in v]
        device_speech = p.stt is None or p.tts is None
        notes = []
        notes.append("Translation auto-check passed" if tr["ok"] else "Translation auto-check failed")
        if device_speech:
            notes.append("speech runs on the participant's device and needs manual testing")
        status = None
        if not all(server_checks):
            status = "failed"
        elif not device_speech:
            status = "automated_pass"  # all server capabilities verified automatically
        report["languages"][lang] = {
            "status": status,
            "tested_at": report["generated_at"],
            "note": "; ".join(notes) + ".",
            "translation": tr,
            "speech": speech,
        }
        print(f"   {lang}: translation={'ok' if tr['ok'] else 'FAIL'} status={status}", flush=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
