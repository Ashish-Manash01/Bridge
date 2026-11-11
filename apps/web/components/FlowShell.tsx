"use client";

import { Check } from "lucide-react";

import { VoiceOrb } from "./brand/VoiceOrb";

/** Two-column layout for create/join: form on the left, a calm night panel on the right (desktop only). */
export function FlowShell({
  children,
  title,
  points,
}: {
  children: React.ReactNode;
  title: string;
  points: string[];
}) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-16 pt-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:pt-8">
      <main id="main" className="mx-auto w-full max-w-xl lg:mx-0">
        {children}
      </main>
      <aside className="night sticky top-24 hidden h-fit overflow-hidden rounded-[32px] p-8 lg:block" aria-hidden>
        <div className="grid-fade pointer-events-none absolute inset-0" />
        <div className="relative">
          <div className="flex justify-center py-4">
            <VoiceOrb state="idle" size={180} />
          </div>
          <p className="font-display mt-4 text-2xl font-semibold leading-tight">{title}</p>
          <ul className="mt-6 space-y-3 text-[15px] text-white/75">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10">
                  <Check className="size-3 text-[#7ff0e4]" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
