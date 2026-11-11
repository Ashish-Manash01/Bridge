"""Language catalogue. Capability per provider lives on the provider adapters;
the matrix exposed to clients is computed in services/capabilities.py."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    code: str  # ISO 639-1 base code used throughout BRIDGE
    locale: str  # BCP-47 locale used by speech providers
    name: str
    native_name: str
    script_dir: str = "ltr"


LANGUAGES: dict[str, Language] = {
    lang.code: lang
    for lang in [
        Language("en", "en-IN", "English", "English"),
        Language("hi", "hi-IN", "Hindi", "हिन्दी"),
        Language("kn", "kn-IN", "Kannada", "ಕನ್ನಡ"),
        Language("ta", "ta-IN", "Tamil", "தமிழ்"),
        Language("te", "te-IN", "Telugu", "తెలుగు"),
        Language("ml", "ml-IN", "Malayalam", "മലയാളം"),
        Language("bn", "bn-IN", "Bengali", "বাংলা"),
        Language("mr", "mr-IN", "Marathi", "मराठी"),
        Language("gu", "gu-IN", "Gujarati", "ગુજરાતી"),
        Language("pa", "pa-IN", "Punjabi", "ਪੰਜਾਬੀ"),
        Language("ur", "ur-IN", "Urdu", "اردو", "rtl"),
        Language("es", "es-ES", "Spanish", "Español"),
        Language("fr", "fr-FR", "French", "Français"),
        Language("de", "de-DE", "German", "Deutsch"),
        Language("ar", "ar-SA", "Arabic", "العربية", "rtl"),
    ]
}


def normalize_language(code: str | None) -> str | None:
    """Map provider codes like 'kn-IN' or 'KN' to the base code 'kn'."""
    if not code:
        return None
    base = code.replace("_", "-").split("-")[0].lower()
    return base if base in LANGUAGES else None


def locale_for(code: str) -> str:
    return LANGUAGES[code].locale
