"use client";

import { useEffect, useRef, useState } from "react";

import { DEFAULT_TELEMETRY_ORDER } from "@/components/chat-studio/chat-constants";
import { normalizeRunSettingsOrder } from "@/components/chat-studio/chat-helpers";
import { updateRunSettingsOrder } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { RunSettingsSectionKey, User } from "@/lib/types";

const SAVE_DEBOUNCE_MS = 600;

interface UseRunSettingsOrderParams {
  authToken: string;
  user: User | null;
  refreshProfile: () => void;
  onError: (message: string) => void;
}

interface UseRunSettingsOrderResult {
  runSettingsOrder: RunSettingsSectionKey[];
  setRunSettingsOrder: React.Dispatch<React.SetStateAction<RunSettingsSectionKey[]>>;
}

/**
 * Owns the telemetry run-settings section order plus its debounced persistence to
 * the user profile. Hydrates from `user.run_settings_order` and writes back changes
 * after a short debounce, mirroring the last-saved serialization to avoid redundant PUTs.
 */
export function useRunSettingsOrder({
  authToken,
  user,
  refreshProfile,
  onError,
}: UseRunSettingsOrderParams): UseRunSettingsOrderResult {
  const [runSettingsOrder, setRunSettingsOrder] =
    useState<RunSettingsSectionKey[]>(DEFAULT_TELEMETRY_ORDER);
  const saveTimeoutRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(DEFAULT_TELEMETRY_ORDER));

  useEffect(() => {
    const normalizedOrder = normalizeRunSettingsOrder(user?.run_settings_order ?? null);
    setRunSettingsOrder(normalizedOrder);
    lastSavedRef.current = JSON.stringify(normalizedOrder);
  }, [user]);

  useEffect(() => {
    if (!authToken || !user) {
      return;
    }
    const serialized = JSON.stringify(runSettingsOrder);
    if (serialized === lastSavedRef.current) {
      return;
    }
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      updateRunSettingsOrder(authToken, runSettingsOrder)
        .then(() => {
          lastSavedRef.current = serialized;
          refreshProfile();
        })
        .catch((error: unknown) => {
          onError(getErrorMessage(error, "Unable to save run settings order."));
        });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [authToken, refreshProfile, runSettingsOrder, user, onError]);

  return { runSettingsOrder, setRunSettingsOrder };
}
