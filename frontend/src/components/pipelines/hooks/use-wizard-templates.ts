"use client";

import { useCallback, useMemo, useState } from "react";

import { fetchToolTemplates } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { ToolTemplate } from "@/lib/types";

export type WizardTemplates = {
  all: ToolTemplate[];
  /** The chosen template, or the catalog's first until one is chosen. */
  selected: ToolTemplate | null;
  loading: boolean;
  error: string | null;
  select: (template: ToolTemplate) => void;
  reset: () => void;
};

const EMPTY: ToolTemplate[] = [];

/**
 * The shipped tool-template catalog, and which one the wizard is building.
 *
 * The catalog is the server's (`app/pipelines/tool_defaults.py`), so the
 * wizard offers exactly the templates the scaffold endpoint can build.
 */
export function useWizardTemplates(token: string, open: boolean): WizardTemplates {
  const query = useApiQuery(() => fetchToolTemplates(token), [token], { enabled: open });
  const all = query.data ?? EMPTY;
  const [selectedId, setSelectedId] = useState("");

  const selected = useMemo(
    () => all.find((template) => template.id === selectedId) ?? all[0] ?? null,
    [all, selectedId],
  );
  const select = useCallback((template: ToolTemplate) => setSelectedId(template.id), []);
  const reset = useCallback(() => setSelectedId(""), []);

  return { all, selected, loading: query.loading, error: query.error, select, reset };
}
