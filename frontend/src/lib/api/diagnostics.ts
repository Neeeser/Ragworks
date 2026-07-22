import { apiFetch } from "@/lib/api/client";

import type { CollectionDiagnosticsResponse } from "@/lib/types";

/** Fetch cross-pipeline compatibility diagnostics for a collection. */
export async function fetchCollectionDiagnostics(
  token: string,
  collectionId: string,
): Promise<CollectionDiagnosticsResponse> {
  return apiFetch<CollectionDiagnosticsResponse>(`/api/collections/${collectionId}/diagnostics`, {
    token,
  });
}
