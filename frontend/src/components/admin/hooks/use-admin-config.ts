"use client";

import { useCallback, useMemo, useState } from "react";

import {
  configFieldError,
  configValuesEqual,
} from "@/components/admin/settings/config-field-validation";
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

  const catalog = useMemo(() => fields ?? data ?? [], [fields, data]);

  /**
   * The drafts that actually differ from what is stored.
   *
   * Derived from values rather than from which keys were touched: a field
   * typed over and put back is not a change, and counting it as one leaves
   * the page permanently unsaved with Discard as the only exit.
   */
  const changed = useMemo(() => {
    const stored = new Map(catalog.map((field) => [field.key, field.value]));
    return new Set(
      Object.keys(dirty).filter((key) => !configValuesEqual(dirty[key], stored.get(key))),
    );
  }, [catalog, dirty]);

  /** Per-field validity, read off the catalog's own bounds and option sets. */
  const errors = useMemo(() => {
    const found = new Map<string, string>();
    for (const field of catalog) {
      if (!Object.hasOwn(dirty, field.key)) continue;
      const message = configFieldError(field, dirty[field.key]);
      if (message) found.set(field.key, message);
    }
    return found;
  }, [catalog, dirty]);

  const isDirty = useCallback((key: string) => changed.has(key), [changed]);

  const errorFor = useCallback((key: string) => errors.get(key) ?? null, [errors]);

  const dirtyCount = changed.size;
  const invalidCount = errors.size;

  const discardAll = useCallback(() => {
    setDirty({});
    setError(null);
    setSuccess(null);
  }, []);

  const saveAll = useCallback(async () => {
    // Refuses an invalid draft rather than sending it: the API rejects it
    // anyway, and a 400 phrased in the server's terms names no field.
    if (!token || changed.size === 0 || errors.size > 0) return;
    setError(null);
    setSuccess(null);
    const patch: AppConfigUpdate = {};
    for (const key of changed) {
      const { section, leaf } = splitKey(key);
      patch[section] = { ...patch[section], [leaf]: dirty[key] };
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
  }, [token, dirty, changed, errors]);

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

  // Reads the draft map directly, not `isDirty`: what the user typed stays on
  // screen even when it matches the stored value, which is the only way an
  // out-of-range entry can be shown with the error explaining it.
  const draftValue = useCallback(
    (field: ConfigFieldRead): unknown =>
      Object.hasOwn(dirty, field.key) ? dirty[field.key] : field.value,
    [dirty],
  );

  const sections = useMemo(() => {
    const grouped = new Map<string, ConfigFieldRead[]>();
    for (const field of catalog) {
      const { section } = splitKey(field.key);
      const existing = grouped.get(section);
      if (existing) {
        existing.push(field);
      } else {
        grouped.set(section, [field]);
      }
    }
    return grouped;
  }, [catalog]);

  return {
    sections,
    loading,
    loadError,
    error,
    success,
    saving,
    dirtyCount,
    invalidCount,
    setDraft,
    isDirty,
    errorFor,
    draftValue,
    saveAll,
    discardAll,
    reset,
  };
}
