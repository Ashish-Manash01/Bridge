import type { LanguageCapability, PublicConfig } from "./types";

// Fallback names used only before /api/config loads. Capabilities always come
// from the server's matrix; nothing here implies support.
const NAMES: Record<string, [string, string, string]> = {
  en: ["English", "English", "en-IN"],
  hi: ["Hindi", "हिन्दी", "hi-IN"],
  kn: ["Kannada", "ಕನ್ನಡ", "kn-IN"],
  ta: ["Tamil", "தமிழ்", "ta-IN"],
  te: ["Telugu", "తెలుగు", "te-IN"],
  ml: ["Malayalam", "മലയാളം", "ml-IN"],
  bn: ["Bengali", "বাংলা", "bn-IN"],
  mr: ["Marathi", "मराठी", "mr-IN"],
  gu: ["Gujarati", "ગુજરાતી", "gu-IN"],
  pa: ["Punjabi", "ਪੰਜਾਬੀ", "pa-IN"],
  ur: ["Urdu", "اردو", "ur-IN"],
  es: ["Spanish", "Español", "es-ES"],
  fr: ["French", "Français", "fr-FR"],
  de: ["German", "Deutsch", "de-DE"],
  ar: ["Arabic", "العربية", "ar-SA"],
};

export function langInfo(config: PublicConfig | null, code: string | null | undefined): LanguageCapability | null {
  if (!code) return null;
  return config?.languages.find((l) => l.code === code) ?? null;
}

export function langName(config: PublicConfig | null, code: string | null | undefined): string {
  if (!code) return "Unknown";
  return langInfo(config, code)?.name ?? NAMES[code]?.[0] ?? code.toUpperCase();
}

export function nativeName(config: PublicConfig | null, code: string | null | undefined): string {
  if (!code) return "";
  return langInfo(config, code)?.native_name ?? NAMES[code]?.[1] ?? code;
}

export function localeOf(config: PublicConfig | null, code: string): string {
  return langInfo(config, code)?.locale ?? NAMES[code]?.[2] ?? code;
}

export function dirOf(config: PublicConfig | null, code: string | null | undefined): "ltr" | "rtl" {
  return (code && langInfo(config, code)?.dir) || "ltr";
}

export function testedLabel(l: LanguageCapability): string {
  switch (l.tested) {
    case "human_reviewed":
      return "Human-reviewed";
    case "automated_pass":
      return "Automated check passed";
    case "failed":
      return "Known issues";
    default:
      return "Not yet verified";
  }
}
