const WORDS: { text: string; lang: string }[] = [
  { text: "Hello", lang: "en" },
  { text: "ನಮಸ್ಕಾರ", lang: "kn" },
  { text: "नमस्ते", lang: "hi" },
  { text: "வணக்கம்", lang: "ta" },
  { text: "నమస్కారం", lang: "te" },
  { text: "നമസ്കാരം", lang: "ml" },
];

/**
 * Cycles a greeting through BRIDGE's launch languages (Text Rotate pattern).
 * All words are rendered once and stacked in one grid cell; CSS fades them in
 * turn (opacity/transform only). No timers, no text changes: text is shaped a
 * single time, which keeps the page cheap on low-end devices.
 */
export function RotatingHello({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="sr-only">Hello, in six languages</span>
      <span aria-hidden className="hello-stack">
        {WORDS.map((w, i) => (
          <span key={w.lang} lang={w.lang} className="hello-word" style={{ animationDelay: `${i * 2.2}s` }}>
            {w.text}
          </span>
        ))}
      </span>
    </span>
  );
}
