import { apiFetch } from "@/lib/api/client";

import type {
  CollectionDiagnosticsPreviewPayload,
  CollectionDiagnosticsResponse,
  DiagnosticsSummary,
} from "@/lib/types";

/** Fetch cross-pipeline compatibility diagnostics for a collection. */
export async function fetchCollectionDiagnostics(
  token: string,
  collectionId: string,
): Promise<CollectionDiagnosticsResponse> {
  return apiFetch<CollectionDiagnosticsResponse>(`/api/collections/${collectionId}/diagnostics`, {
    token,
  });
}

/** Run the same rules over a collection configuration that does not exist yet. */
export async function previewCollectionDiagnostics(
  token: string,
  payload: CollectionDiagnosticsPreviewPayload,
): Promise<DiagnosticsSummary> {
  return apiFetch<DiagnosticsSummary>("/api/collections/diagnostics/preview", {
    token,
    method: "POST",
    body: JSON.stringify(payload),
  });
}
