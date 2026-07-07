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

/** Owns the admin config catalog, local dirty edits, and save/reset mutations. */
export function useAdminConfig() {
  const { token } = useAuth();
  const [fields, setFields] = useState<ConfigFieldRead[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, unknown>>({});
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    data,
    loading,
    error: loadError,
  } = useApiQuery(() => fetchAdminConfig(token ?? ""), [token], { enabled: Boolean(token) });

  const setDraft = useCallback((key: string, value: unknown) => {
    setDirty((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isDirty = useCallback((key: string) => Object.hasOwn(dirty, key), [dirty]);

  const sectionIsDirty = useCallback(
    (section: string) => Object.keys(dirty).some((key) => splitKey(key).section === section),
    [dirty],
  );

  const clearSectionDirty = useCallback((section: string) => {
    setDirty((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (splitKey(key).section === section) {
          delete next[key];
        }
      }
      return next;
    });
  }, []);

  const save = useCallback(
    async (section: string) => {
      if (!token) return;
      setError(null);
      setSuccess(null);
      const patch: AppConfigUpdate = { [section]: {} };
      for (const [key, value] of Object.entries(dirty)) {
        const parts = splitKey(key);
        if (parts.section !== section) continue;
        patch[section][parts.leaf] = value;
      }
      if (Object.keys(patch[section]).length === 0) return;
      setSavingSection(section);
      try {
        const refreshed = await updateAdminConfig(token, patch);
        setFields(refreshed);
        clearSectionDirty(section);
        setSuccess("Settings saved.");
      } catch (err) {
        setError(getErrorMessage(err, "Failed to save settings."));
      } finally {
        setSavingSection(null);
      }
    },
    [token, dirty, clearSectionDirty],
  );

  const reset = useCallback(
    async (fieldKey: string) => {
      if (!token) return;
      setError(null);
      setSuccess(null);
      const { section, leaf } = splitKey(fieldKey);
      setSavingSection(section);
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
        setSavingSection(null);
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
    savingSection,
    setDraft,
    isDirty,
    sectionIsDirty,
    draftValue,
    save,
    reset,
  };
}
