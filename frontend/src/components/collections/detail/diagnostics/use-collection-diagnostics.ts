import { fetchCollectionDiagnostics } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { CollectionDiagnosticsResponse } from "@/lib/types";

export interface UseCollectionDiagnosticsResult {
  data: CollectionDiagnosticsResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Load a collection's diagnostics, reloading when the token/collection change. */
export function useCollectionDiagnostics(
  token: string,
  collectionId: string,
): UseCollectionDiagnosticsResult {
  return useApiQuery<CollectionDiagnosticsResponse>(
    () => fetchCollectionDiagnostics(token, collectionId),
    [token, collectionId],
    { enabled: Boolean(token) },
  );
}
