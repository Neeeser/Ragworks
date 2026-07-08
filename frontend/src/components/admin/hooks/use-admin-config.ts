"use client";

import { useCallback, useMemo, useState } from "react";

import { fetchAdminConfig, updateAdminConfig } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type { AppConfigUpdate, ConfigFieldRead } from "@/lib/types";

/** Splits a catalog field's dot-separated key into its section and leaf. */
function splitKey(key: string): { section: string; leaf: string } {
  const dot = key.indexOf(".");
  return { section: key.slice(0, dot), leaf: key.slice(dot + 1) };
}

/** Owns the admin config catalog, local dirty edits, and save/reset mutations.

The catalog (and therefore the page) is entirely schema-driven: sections are
derived from key prefixes, so a new backend config field — or a whole new
section — renders here with zero frontend changes. Edits accumulate across
sections into one dirty map and save as a single sparse patch. */
export function useAdminConfig() {
  const { token } = useAuth();
  const [fields, setFields] = useState<ConfigFieldRead[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    data,
    loading,
    error: loadError,
  } = useApiQuery(() => fetchAdminConfig(token ?? ""), [token], { enabled: Boolean(token) });

  const setDraft = useCallback((key: string, value: unknown) => {
    setSuccess(null);
    setDirty((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isDirty = useCallback((key: string) => Object.hasOwn(dirty, key), [dirty]);

  const dirtyCount = Object.keys(dirty).length;

  const discardAll = useCallback(() => {
    setDirty({});
    setError(null);
    setSuccess(null);
  }, []);

  const saveAll = useCallback(async () => {
    if (!token || Object.keys(dirty).length === 0) return;
    setError(null);
    setSuccess(null);
    const patch: AppConfigUpdate = {};
    for (const [key, value] of Object.entries(dirty)) {
      const { section, leaf } = splitKey(key);
      patch[section] = { ...patch[section], [leaf]: value };
    }
    setSaving(true);
    try {
      const refreshed = await updateAdminConfig(token, patch);
      setFields(refreshed);
      setDirty({});
      setSuccess("Settings saved.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save settings."));
    } finally {
      setSaving(false);
    }
  }, [token, dirty]);

  const reset = useCallback(
    async (fieldKey: string) => {
      if (!token) return;
      setError(null);
      setSuccess(null);
      const { section, leaf } = splitKey(fieldKey);
      setSaving(true);
      try {
        const refreshed = await updateAdminConfig(token, { [section]: { [leaf]: null } });
        setFields(refreshed);
        setDirty((prev) => {
          const next = { ...prev };
          delete next[fieldKey];
          return next;
        });
        setSuccess("Setting reset to default.");
      } catch (err) {
        setError(getErrorMessage(err, "Failed to reset setting."));
      } finally {
        setSaving(false);
      }
    },
    [token],
  );

  const draftValue = useCallback(
    (field: ConfigFieldRead): unknown => (isDirty(field.key) ? dirty[field.key] : field.value),
    [dirty, isDirty],
  );

  const sections = useMemo(() => {
    const grouped = new Map<string, ConfigFieldRead[]>();
    for (const field of fields ?? data ?? []) {
      const { section } = splitKey(field.key);
      const existing = grouped.get(section);
      if (existing) {
        existing.push(field);
      } else {
        grouped.set(section, [field]);
      }
    }
    return grouped;
  }, [fields, data]);

  return {
    sections,
    loading,
    loadError,
    error,
    success,
    saving,
    dirtyCount,
    setDraft,
    isDirty,
    draftValue,
    saveAll,
    discardAll,
    reset,
  };
}
