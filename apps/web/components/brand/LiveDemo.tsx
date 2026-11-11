import { Check, Languages, Mic } from "lucide-react";

import { MotionToggle } from "../landing/MotionToggle";
import { VoiceOrb } from "./VoiceOrb";

// A scripted illustration of one room seen from Asha's (English) phone. It is
// labelled as a demo; nothing here is presented as real output.
// Animation is pure CSS (see .demo-* in globals.css): every message is rendered
// once and revealed in sequence with opacity/transform, so no text is re-laid out.
const SCRIPT = [
  { who: "Ananya", color: "#7c5cff", lang: "Kannada", orig: "ನಾಳೆ ಲೈಬ್ರರಿಯಲ್ಲಿ ಐದು ಗಂಟೆಗೆ ಸಿಗೋಣವಾ?", origLang: "kn", mine: "Shall we meet at the library tomorrow at five?" },
  { who: "Rahul", color: "#e8892c", lang: "Hindi", orig: "हाँ, मैं प्रोजेक्ट की स्लाइड्स भी ले आऊँगा।", origLang: "hi", mine: "Yes, I'll bring the project slides too." },
  { who: "Kavin", color: "#1f9d8f", lang: "Tamil", orig: "சரி, நான் ஐந்தரைக்கு வருவேன்.", origLang: "ta", mine: "Okay, I'll come at five thirty." },
];

export function LiveDemo() {
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <div className="absolute -inset-10 -z-10 rounded-[48px] bg-[radial-gradient(closest-side,rgba(124,92,255,0.32),rgba(124,92,255,0.12)_55%,transparent)]" aria-hidden />
      <div className="rounded-[36px] border border-white/10 bg-[#0f1526]/90 p-2.5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/5">
        <div className="overflow-hidden rounded-[28px] bg-[#f7f5f0] text-[#14171c]">
          <div className="flex items-center justify-between bg-white px-4 pb-3 pt-4">
            <div>
              <p className="text-[13px] font-bold">Project group</p>
              <p className="flex items-center gap-1 text-[11px] text-[#5d636d]">
                <span className="size-1.5 rounded-full bg-[#24724a]" /> Live · 4 people · your feed in English
              </p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-[#ecebff] px-2 py-1 text-[10px] font-bold text-[#5b3fe0]">
              <Languages className="size-3" aria-hidden /> 4 languages
            </span>
          </div>

          <ol className="flex h-[318px] flex-col justify-end gap-2.5 overflow-hidden px-3 py-3" aria-label="Demo conversation">
            {SCRIPT.map((m, i) => (
              <li
                key={m.who}
                className="demo-msg relative rounded-2xl rounded-tl-md bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_18px_-8px_rgba(20,23,28,0.15)]"
                style={{ animationDelay: `${i * 3}s` }}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <span className="flex size-5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: m.color }}>
                    {m.who[0]}
                  </span>
                  {m.who}
                  <span className="font-medium text-[#5d636d]">· spoke {m.lang}</span>
                </p>
                {/* Two stacked layers: "translating…" fades out, the translation fades in. */}
                <div className="relative mt-1">
                  <div className="demo-final" style={{ animationDelay: `${i * 3}s` }}>
                    <p className="text-[14.5px] font-semibold leading-snug">{m.mine}</p>
                    <p lang={m.origLang} className="script-text mt-1 border-l-2 border-[#e0dbd1] pl-2 text-[12px] text-[#5d636d]">
                      {m.orig}
                    </p>
                  </div>
                  <p className="demo-pending absolute inset-x-0 top-0 flex items-center gap-1.5 text-[13px] text-[#5b3fe0]" style={{ animationDelay: `${i * 3}s` }} aria-hidden>
                    <span className="flex items-end gap-[3px]">
                      {[0, 1, 2, 3, 4].map((bar) => (
                        <span key={bar} className="eq-bar w-[3px] rounded-full" style={{ background: m.color, animationDelay: `${bar * 0.12}s` }} />
                      ))}
                    </span>
                    speaking · translating…
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-center justify-between border-t border-[#e0dbd1] bg-white px-4 py-3">
            <span className="flex items-center gap-1 text-[11px] font-medium text-[#24724a]">
              <Check className="size-3.5" aria-hidden /> Original always one tap away
            </span>
            <span className="relative flex size-14 items-center justify-center">
              <span className="absolute inset-0 flex items-center justify-center">
                <VoiceOrb state="listening" level={0.45} size={56} />
              </span>
              <Mic className="relative size-4 text-white" aria-hidden />
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 text-xs text-white/60">
        <span>Demo animation · Ananya reads the same messages in Kannada</span>
        <MotionToggle />
      </div>
    </div>
  );
}
