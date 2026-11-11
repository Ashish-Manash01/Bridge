"""Prompt construction and response parsing shared by LLM-backed providers
(OpenAI, Anthropic) for translation and conversation summaries."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence

from app.core.languages import LANGUAGES
from app.providers.base import GlossaryEntry, ProviderError, TranslationContext
from app.providers.glossary import relevant_entries

TRANSLATION_SYSTEM = (
    "You are the translation engine inside BRIDGE, a live multilingual group conversation app. "
    "Translate the speaker's utterance faithfully and naturally for spoken conversation. "
    "Preserve meaning, tone, names, numbers and technical terms. Speakers may mix languages "
    "(code-switching); translate the whole utterance into the target language, keeping proper "
    "nouns intact. Never add commentary. If the utterance is ambiguous or seems garbled, still "
    "translate your best reading and set uncertain to true. "
    'Respond with JSON only: {"translation": string, "uncertain": boolean, "glossary_terms_used": string[]}'
)


def translation_prompt(
    text: str,
    source_language: str,
    target_language: str,
    glossary: Sequence[GlossaryEntry] | None,
    context: TranslationContext | None,
) -> tuple[str, list[str]]:
    src = LANGUAGES[source_language].name
    tgt = LANGUAGES[target_language].name
    entries = relevant_entries(glossary, source_language, target_language)
    parts = [f"Source language: {src}", f"Target language: {tgt}"]
    if context and context.topic:
        parts.append(f"Conversation topic: {context.topic}")
    if entries:
        lines = []
        for e in entries:
            if e.preferred_translation:
                lines.append(f'- "{e.source_term}" -> "{e.preferred_translation}"')
            else:
                lines.append(f'- "{e.source_term}" (keep as-is; proper noun or term)')
        parts.append("Room glossary (use these renderings when the term appears):\n" + "\n".join(lines))
    if context and context.recent_turns:
        recent = "\n".join(f"- {t}" for t in context.recent_turns)
        parts.append(f"Recent conversation turns, for context only (do not translate):\n{recent}")
    parts.append(f"Utterance to translate:\n<<<\n{text}\n>>>")
    return "\n\n".join(parts), [e.source_term for e in entries]


def parse_json_object(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ProviderError("provider_bad_response", "The model returned an unexpected format.")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise ProviderError("provider_bad_response", "The model returned malformed JSON.") from exc


SUMMARY_SYSTEM = (
    "You summarise multilingual group conversations recorded by BRIDGE. Work only from the "
    "transcript provided; never invent facts. Be concise. "
    'Respond with JSON only: {"summary": string, "decisions": string[], "action_items": string[], '
    '"open_questions": string[]}'
)


def summary_prompt(transcript: str, language: str) -> str:
    return (
        f"Write the summary and lists in {LANGUAGES[language].name}.\n\n"
        f"Transcript (speaker: original text [translation if any]):\n<<<\n{transcript}\n>>>"
    )
