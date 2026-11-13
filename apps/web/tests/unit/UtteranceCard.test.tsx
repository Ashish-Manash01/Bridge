import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UtteranceCard } from "@/components/room/UtteranceCard";
import type { Participant, Translation, Utterance } from "@/lib/types";

const me: Participant = {
  id: "p2",
  display_name: "Ravi",
  preferred_language: "kn",
  spoken_language: "kn",
  output_mode: "captions",
  audio_muted: false,
  role: "participant",
  joined_at: "",
  left_at: null,
  online: true,
};
const speaker = { id: "p1", display_name: "Asha" };
const base: Utterance = {
  id: "u1",
  room_id: "r1",
  participant_id: "p1",
  speaker_name: "Asha",
  sequence_number: 1,
  input_mode: "voice_browser",
  source_language: "en",
  original_text: "Where is the library?",
  recognition_confidence: 0.9,
  stt_provider: "browser",
  processing_status: "complete",
  error_code: null,
  created_at: "2026-01-01T10:00:00Z",
  translations: [],
};
const kn: Translation = {
  id: "t1",
  utterance_id: "u1",
  target_language: "kn",
  translated_text: "ಗ್ರಂಥಾಲಯ ಎಲ್ಲಿದೆ?",
  provider: "mymemory",
  quality_status: "translated",
  quality_note: null,
  glossary_terms: [],
  latency_ms: 900,
  created_at: "",
};

function renderCard(u: Utterance, overrides: Partial<React.ComponentProps<typeof UtteranceCard>> = {}) {
  const actions = { onPlay: vi.fn(), onStop: vi.fn(), onReport: vi.fn(), onRepeat: vi.fn(), onRetryTranslation: vi.fn() };
  render(
    <UtteranceCard u={u} me={me} speaker={speaker} config={null} playingId={null} voiceAvailable retrying={false} {...actions} {...overrides} />,
  );
  return actions;
}

describe("UtteranceCard", () => {
  it("shows the translation in my language with the speaker and an expandable original", () => {
    renderCard({ ...base, translations: [kn] });
    expect(screen.getByText("ಗ್ರಂಥಾಲಯ ಎಲ್ಲಿದೆ?")).toBeInTheDocument();
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(screen.queryByText("Where is the library?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Original \(English\)/ }));
    expect(screen.getByText("Where is the library?")).toBeInTheDocument();
  });

  it("falls back to the original with a clear badge when my translation failed, and offers retry", () => {
    const actions = renderCard({ ...base, processing_status: "partial", translations: [{ ...kn, translated_text: null, quality_status: "failed" }] });
    expect(screen.getByText("Where is the library?")).toBeInTheDocument();
    expect(screen.getByText(/Translation failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry translation" }));
    expect(actions.onRetryTranslation).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "kn");
  });

  it("flags uncertain translations in words, not just colour", () => {
    renderCard({ ...base, translations: [{ ...kn, quality_status: "uncertain", quality_note: "Speech recognition confidence was low." }] });
    expect(screen.getByText(/Uncertain: Speech recognition confidence was low/)).toBeInTheDocument();
  });

  it("shows a translating state before the translation arrives", () => {
    renderCard({ ...base, processing_status: "transcribed" });
    expect(screen.getByText(/Translating/)).toBeInTheDocument();
  });

  it("offers replay, report and ask-to-repeat controls", () => {
    const actions = renderCard({ ...base, translations: [kn] });
    fireEvent.click(screen.getByRole("button", { name: "Play translation" }));
    expect(actions.onPlay).toHaveBeenCalledWith(kn);
    fireEvent.click(screen.getByRole("button", { name: "Translation seems wrong" }));
    expect(actions.onReport).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ask Asha to repeat" }));
    expect(actions.onRepeat).toHaveBeenCalled();
  });

  it("shows Stop while that translation is playing", () => {
    const actions = renderCard({ ...base, translations: [kn] }, { playingId: "t1" });
    fireEvent.click(screen.getByRole("button", { name: "Stop audio" }));
    expect(actions.onStop).toHaveBeenCalled();
  });

  it("hides audio controls when voice is unavailable (captions-only fallback)", () => {
    renderCard({ ...base, translations: [kn] }, { voiceAvailable: false });
    expect(screen.queryByRole("button", { name: "Play translation" })).not.toBeInTheDocument();
    expect(screen.getByText("ಗ್ರಂಥಾಲಯ ಎಲ್ಲಿದೆ?")).toBeInTheDocument();
  });

  it("explains recognition failures and still lets listeners ask for a repeat", () => {
    renderCard({ ...base, original_text: null, processing_status: "failed", error_message: "No speech was detected." });
    expect(screen.getByText("No speech was detected.")).toBeInTheDocument();
    expect(screen.getByText("Not recognised")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Asha to repeat" })).toBeInTheDocument();
  });

  it("shows my own message with per-language delivery status", () => {
    render(
      <UtteranceCard
        u={{ ...base, participant_id: "p2", translations: [{ ...kn, target_language: "en" }, { ...kn, id: "t2", target_language: "hi", quality_status: "failed", translated_text: null }] }}
        me={me}
        speaker={{ id: "p2", display_name: "Ravi" }}
        config={null}
        playingId={null}
        voiceAvailable
        retrying={false}
        onPlay={vi.fn()}
        onStop={vi.fn()}
        onReport={vi.fn()}
        onRepeat={vi.fn()}
        onRetryTranslation={vi.fn()}
      />,
    );
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText(/Delivered in/)).toHaveTextContent("English ✓");
    expect(screen.getByText(/Delivered in/)).toHaveTextContent("Hindi (failed)");
  });

  it("shows the original (not an endless spinner) for messages sent before I joined, with a Translate action", () => {
    const actions = renderCard({ ...base, processing_status: "complete", translations: [] });
    expect(screen.getByText("Where is the library?")).toBeInTheDocument();
    expect(screen.getByText(/Not translated yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Translating/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Translate into/ }));
    expect(actions.onRetryTranslation).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "kn");
  });
});
