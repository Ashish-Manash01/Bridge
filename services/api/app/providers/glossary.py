"""Glossary handling for providers without native glossary support.

Strategy: protect matched source terms with opaque placeholder tokens before
translation, then substitute the preferred rendering afterwards. If the
provider drops or mangles any placeholder, the protected translation is
discarded and the caller falls back to a plain translation, reporting that the
glossary could not be applied. Meaning is never silently rewritten: the
applied terms are returned so the UI can show them.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from app.providers.base import GlossaryEntry, TranslationResult


def relevant_entries(
    glossary: Sequence[GlossaryEntry] | None, source_language: str, target_language: str
) -> list[GlossaryEntry]:
    if not glossary:
        return []
    out = []
    for e in glossary:
        if e.source_language and e.source_language != source_language:
            continue
        if e.target_language and e.target_language != target_language:
            continue
        out.append(e)
    # Longest first so "New York University" wins over "New York".
    return sorted(out, key=lambda e: len(e.source_term), reverse=True)


def _pattern(term: str) -> re.Pattern[str]:
    escaped = re.escape(term.strip())
    if term.isascii():
        return re.compile(rf"(?<![\w]){escaped}(?![\w])", re.IGNORECASE)
    # Indic scripts: word-boundary semantics are unreliable around combining
    # marks, so match the literal sequence.
    return re.compile(escaped)


@dataclass
class Protected:
    text: str
    replacements: dict[str, str]  # token -> rendering
    terms: list[str]


def protect(text: str, entries: Sequence[GlossaryEntry]) -> Protected:
    replacements: dict[str, str] = {}
    terms: list[str] = []
    for i, entry in enumerate(entries):
        token = f"ZXQ{i}Q"  # opaque, Latin, unlikely to be translated
        pat = _pattern(entry.source_term)
        new_text, n = pat.subn(token, text)
        if n:
            text = new_text
            replacements[token] = entry.preferred_translation or entry.source_term
            terms.append(entry.source_term)
    return Protected(text, replacements, terms)


def restore(translated: str, protected: Protected) -> str | None:
    """Returns None when any placeholder did not survive translation."""
    out = translated
    for token, rendering in protected.replacements.items():
        pat = re.compile(re.escape(token), re.IGNORECASE)
        if not pat.search(out):
            return None
        out = pat.sub(rendering, out)
    return out


async def translate_with_glossary(
    text: str,
    source_language: str,
    target_language: str,
    glossary: Sequence[GlossaryEntry] | None,
    raw_translate: Callable[[str], Awaitable[str]],
    provider_name: str,
) -> TranslationResult:
    entries = relevant_entries(glossary, source_language, target_language)
    protected = protect(text, entries) if entries else None
    if protected and protected.replacements:
        translated = await raw_translate(protected.text)
        restored = restore(translated, protected)
        if restored is not None:
            return TranslationResult(restored, provider_name, glossary_terms_applied=protected.terms)
        plain = await raw_translate(text)
        return TranslationResult(plain, provider_name, note="Glossary terms could not be applied to this translation.")
    return TranslationResult(await raw_translate(text), provider_name)
