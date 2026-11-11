"use client";

import { Check, Minus, Smartphone } from "lucide-react";

import { MockBanner, SiteHeader, useDeviceSupport } from "@/components/common";
import { Badge, Notice } from "@/components/ui";
import { useConfig } from "@/hooks/useConfig";
import { testedLabel } from "@/lib/languages";

function Cell({ value, support }: { value: boolean | "server" | "device" | "none"; support?: boolean }) {
  if (value === true || value === "server") return <Check className="mx-auto size-4 text-success" aria-label="Supported" />;
  if (value === "device")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2" title="Depends on your browser and device">
        <Smartphone className="size-3.5" aria-hidden /> {support === false ? "Not here" : "Device"}
      </span>
    );
  return <Minus className="mx-auto size-4 text-muted" aria-label="Not supported" />;
}

export default function LanguagesPage() {
  const { config, error } = useConfig();
  const support = useDeviceSupport();
  return (
    <>
      <MockBanner config={config} />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Language support</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          This table comes from the live server configuration. &ldquo;Device&rdquo; means the feature uses your browser&apos;s own speech service,
          so availability depends on the browser and device. A language counts as verified only after BRIDGE&apos;s evaluation set has passed.
        </p>
        {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
        {config && (
          <>
            <p className="mt-4 text-sm text-muted">
              Providers: speech input <strong>{config.providers.speech_to_text}</strong> · translation <strong>{config.providers.translation}</strong> · voice{" "}
              <strong>{config.providers.text_to_speech}</strong>
            </p>
            <div className="mt-6 overflow-x-auto rounded-3xl border border-line bg-surface">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Capabilities per language</caption>
                <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3">Language</th>
                    <th scope="col" className="px-3 py-3 text-center">Speech input</th>
                    <th scope="col" className="px-3 py-3 text-center">Detection</th>
                    <th scope="col" className="px-3 py-3 text-center">Translation</th>
                    <th scope="col" className="px-3 py-3 text-center">Voice output</th>
                    <th scope="col" className="px-3 py-3 text-center">Streaming</th>
                    <th scope="col" className="px-4 py-3">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {config.languages.map((l) => (
                    <tr key={l.code}>
                      <th scope="row" className="px-4 py-3 text-left font-medium">
                        <span className="script-text">{l.native_name}</span>
                        {l.native_name !== l.name && <span className="text-muted"> · {l.name}</span>}
                      </th>
                      <td className="px-3 py-3 text-center"><Cell value={l.speech_input} support={support?.speechRecognition} /></td>
                      <td className="px-3 py-3 text-center"><Cell value={l.language_detection} /></td>
                      <td className="px-3 py-3 text-center"><Cell value={l.translation} /></td>
                      <td className="px-3 py-3 text-center"><Cell value={l.speech_output} /></td>
                      <td className="px-3 py-3 text-center"><Cell value={l.streaming} /></td>
                      <td className="px-4 py-3">
                        <Badge tone={l.tested === "human_reviewed" || l.tested === "automated_pass" ? "primary" : l.tested === "failed" ? "danger" : "neutral"}>
                          {testedLabel(l)}
                        </Badge>
                        {l.tested_note && <p className="mt-1 text-xs text-muted">{l.tested_note}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <section className="mt-8 space-y-2 text-[15px] leading-relaxed text-ink-2">
          <h2 className="text-lg font-semibold text-ink">Mixed languages</h2>
          <p>
            Many people mix languages in one sentence, such as Kannada with English words. Some speech services handle this well and others don&apos;t.
            If recognition struggles, choose the language you speak most under <em>I usually speak</em> in the room&apos;s language settings. When
            BRIDGE isn&apos;t sure, it marks the message rather than guessing silently.
          </p>
        </section>
      </main>
    </>
  );
}
