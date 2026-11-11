"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type { PublicConfig } from "@/lib/types";

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig> | null = null;

export function useConfig() {
  const [config, setConfig] = useState<PublicConfig | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    inflight ??= api.config();
    inflight
      .then((c) => {
        cached = c;
        if (alive) setConfig(c);
      })
      .catch((e: ApiError) => {
        inflight = null;
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  return {
    config,
    error,
    retry: () => {
      setError(null);
      setNonce((n) => n + 1);
    },
  };
}
