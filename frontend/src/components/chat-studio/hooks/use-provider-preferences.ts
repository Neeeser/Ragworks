"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildProviderPayload,
  createDefaultProviderForm,
} from "@/components/chat-studio/chat-payload-helpers";
import { listModelEndpoints } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { ProviderFormState } from "@/components/chat-studio/types";
import type { ModelEndpointDirectory, ProviderPreferences } from "@/lib/types";

interface UseProviderPreferencesParams {
  authToken: string;
  authLoading: boolean;
  openrouterConfigured: boolean;
  providerModelSlug: string | null;
}

interface UseProviderPreferencesResult {
  providerForm: ProviderFormState;
  setProviderForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
  providerDirectory: ModelEndpointDirectory | null;
  providerDirectoryLoading: boolean;
  providerDirectoryError: string | null;
  providerSearchTerm: string;
  setProviderSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  providerPayload: ProviderPreferences;
  providerRuleCount: number;
}

/**
 * Owns the provider-routing form, its derived `ProviderPreferences` payload, and the
 * endpoint directory fetch keyed on the active model slug. Preserves the auth-gated
 * directory error messages from the original inline effect.
 */
export function useProviderPreferences({
  authToken,
  authLoading,
  openrouterConfigured,
  providerModelSlug,
}: UseProviderPreferencesParams): UseProviderPreferencesResult {
  const [providerForm, setProviderForm] = useState<ProviderFormState>(() =>
    createDefaultProviderForm(),
  );
  const [providerDirectory, setProviderDirectory] = useState<ModelEndpointDirectory | null>(null);
  const [providerDirectoryLoading, setProviderDirectoryLoading] = useState(false);
  const [providerDirectoryError, setProviderDirectoryError] = useState<string | null>(null);
  const [providerSearchTerm, setProviderSearchTerm] = useState("");

  const providerPayload = useMemo<ProviderPreferences>(
    () => buildProviderPayload(providerForm),
    [providerForm],
  );

  const providerRuleCount = useMemo(() => Object.keys(providerPayload).length, [providerPayload]);

  useEffect(() => {
    if (!providerModelSlug) {
      setProviderDirectory(null);
      setProviderDirectoryError(null);
      setProviderDirectoryLoading(false);
      return;
    }
    if (authLoading) {
      return;
    }
    if (!authToken) {
      setProviderDirectory(null);
      setProviderDirectoryError("Sign in to load providers.");
      setProviderDirectoryLoading(false);
      return;
    }
    if (!openrouterConfigured) {
      setProviderDirectory(null);
      setProviderDirectoryError("Add your OpenRouter API key in Settings to load providers.");
      setProviderDirectoryLoading(false);
      return;
    }
    const [author, ...rest] = providerModelSlug.split("/");
    const slugPart = rest.join("/");
    if (!author || !slugPart) {
      setProviderDirectory(null);
      return;
    }
    let cancelled = false;
    setProviderDirectoryLoading(true);
    setProviderDirectoryError(null);
    listModelEndpoints(authToken || undefined, author, slugPart)
      .then((response) => {
        if (cancelled) return;
        setProviderDirectory(response.data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProviderDirectoryError(getErrorMessage(error, "Unable to load provider catalog."));
        setProviderDirectory(null);
      })
      .finally(() => {
        if (!cancelled) {
          setProviderDirectoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authToken, openrouterConfigured, providerModelSlug]);

  useEffect(() => {
    setProviderSearchTerm("");
  }, [providerModelSlug]);

  return {
    providerForm,
    setProviderForm,
    providerDirectory,
    providerDirectoryLoading,
    providerDirectoryError,
    providerSearchTerm,
    setProviderSearchTerm,
    providerPayload,
    providerRuleCount,
  };
}
