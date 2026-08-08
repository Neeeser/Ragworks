"use client";

import { useEffect, useMemo, useState } from "react";

import { previewCollectionDiagnostics } from "@/lib/api";

import type { CollectionDiagnostic, CollectionDiagnosticsPreviewPayload } from "@/lib/types";

/** How long a selection must hold still before the preview is requested. */
const DEBOUNCE_MS = 400;

interface PreviewResult {
  /** The selection the findings describe, so a superseded answer is ignored. */
  key: string;
  diagnostics: CollectionDiagnostic[];
}

/**
 * Findings for a collection configuration the user has chosen but not created.
 *
 * Debounced, because the request re-fires on every pipeline the user adds or
 * removes. Findings are returned only while they still describe the current
 * selection — a warning about a pairing the user has already changed is worse
 * than none — and a failed request surfaces nothing: the preview is advisory
 * and must never stand between the user and Create.
 */
export function useDiagnosticsPreview(
  token: string,
  enabled: boolean,
  payload: CollectionDiagnosticsPreviewPayload,
): CollectionDiagnostic[] {
  const key = useMemo(() => JSON.stringify(payload), [payload]);
  const [result, setResult] = useState<PreviewResult | null>(null);

  useEffect(() => {
    if (!token || !enabled) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewCollectionDiagnostics(token, payload)
        .then((summary) => {
          if (!cancelled) {
            setResult({ key, diagnostics: summary.diagnostics });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResult({ key, diagnostics: [] });
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, enabled, key, payload]);

  return enabled && result?.key === key ? result.diagnostics : [];
}
