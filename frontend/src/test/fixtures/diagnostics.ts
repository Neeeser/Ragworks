import { TIMESTAMP } from "./files";

import type { CollectionDiagnostic, CollectionDiagnosticsResponse } from "@/lib/types";

export function makeDiagnostic(
  overrides: Partial<CollectionDiagnostic> = {},
): CollectionDiagnostic {
  return {
    code: "embedding_model_mismatch",
    severity: "error",
    confidence: "confirmed",
    category: "embedding",
    title: "Embedding models differ",
    summary: "Ingestion and retrieval use different embedding models.",
    resources: [],
    observations: [{ label: "Embedding model", ingestion: "model-a", retrieval: "model-b" }],
    action: { label: "Edit retrieval pipeline", route: "/pipelines/retrieval" },
    links: [],
    ...overrides,
  };
}

export function makeCollectionDiagnostics(
  overrides: Partial<CollectionDiagnosticsResponse> = {},
): CollectionDiagnosticsResponse {
  const diagnostics = overrides.diagnostics ?? [makeDiagnostic()];
  return {
    collection_id: "col-1",
    generated_at: TIMESTAMP,
    error_count: diagnostics.filter((d) => d.severity === "error").length,
    warning_count: diagnostics.filter((d) => d.severity === "warning").length,
    consistent: !diagnostics.some((d) => d.severity === "error"),
    ...overrides,
    diagnostics,
  };
}
