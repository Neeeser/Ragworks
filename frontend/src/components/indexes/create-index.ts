import type { IndexBackend, IndexCreatePayload } from "@/lib/types";

/** An index-create request before the backend's own rules are applied. */
export type IndexCreateDraft = Omit<IndexCreatePayload, "backend">;

/**
 * Cloud placement is a Pinecone-only concept; pgvector lives in the
 * deployment's own Postgres, and sending it a region is a 400.
 */
export function supportsCloudPlacement(backend: IndexBackend): boolean {
  return backend === "pinecone";
}

/**
 * Shape a create request for one backend: trim the name, drop placement
 * fields the backend has no concept of, and drop the dimension a sparse index
 * never carries.
 *
 * Every creation path goes through here — the registry's full form and the
 * inline create inside a binding flow — so a rule about what a backend accepts
 * is stated once instead of drifting between two forms.
 */
export function buildIndexCreatePayload(
  backend: IndexBackend,
  draft: IndexCreateDraft,
): IndexCreatePayload {
  const payload: IndexCreatePayload = { ...draft, backend, name: draft.name.trim() };
  if (!supportsCloudPlacement(backend)) {
    delete payload.cloud;
    delete payload.region;
    delete payload.deletion_protection;
  }
  if (payload.vector_type === "sparse") {
    delete payload.dimension;
  }
  return payload;
}
