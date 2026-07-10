"use client";

import { useEffect, useState } from "react";

import { validateProviderKey } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

export type KeyValidationState = "idle" | "checking" | "valid" | "invalid";

export interface KeyValidation {
  state: KeyValidationState;
  /** Provider message when invalid (e.g. "Invalid OpenRouter API key."). */
  message: string | null;
}

const DEBOUNCE_MS = 500;

/**
 * Probe a pasted OpenRouter key against the provider (documented `GET /key`
 * check, via the backend's non-persisting `/api/auth/keys/validate`) as the
 * user types, debounced. The wizard gates "Save & continue" on `valid`.
 */
export function useOpenRouterKeyValidation(
  key: string,
  debounceMs: number = DEBOUNCE_MS,
): KeyValidation {
  const { token } = useAuth();
  const trimmed = key.trim();
  const [settled, setSettled] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), debounceMs);
    return () => clearTimeout(timer);
  }, [trimmed, debounceMs]);

  const query = useApiQuery(
    () => validateProviderKey(token ?? "", "openrouter", settled),
    [token, settled],
    { enabled: Boolean(token) && settled.length > 0 },
  );

  if (!trimmed) return { state: "idle", message: null };
  if (trimmed !== settled || query.loading) return { state: "checking", message: null };
  if (query.error) return { state: "invalid", message: "Could not reach OpenRouter to verify." };
  if (query.data?.valid) return { state: "valid", message: null };
  if (query.data) return { state: "invalid", message: query.data.message ?? "Invalid API key." };
  return { state: "checking", message: null };
}
