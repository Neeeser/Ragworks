/**
 * Backend-restriction display for the node library.
 *
 * A node's `supported_backends` is capability-derived on the backend; here we
 * turn it into what the library renders: which backends a store-bound node
 * works with, and whether that's a restriction worth flagging relative to the
 * backends this deployment actually knows about. New backends flow through
 * automatically — a node that can't serve a newly added backend is flagged
 * with no change here.
 */
import type { IndexBackend, NodeSpec } from "@/lib/types";

/** Compact backend names for badges; ParadeDB/pgvector leads (shipped default). */
export const BACKEND_SHORT_LABELS: Record<IndexBackend, string> = {
  pgvector: "ParadeDB / pgvector",
  pinecone: "Pinecone",
};

/**
 * Return the backends a node is restricted to, relative to `knownBackends`,
 * or `null` when there is nothing to flag: the node is store-agnostic
 * (`supported_backends === null`), or it already supports every known
 * backend. A non-null result is the strict subset it DOES support — the list
 * the library renders as "only on …". Empty `knownBackends` (not yet loaded)
 * stays permissive, so the library never flashes a restriction it can't
 * justify.
 */
export function restrictedBackends(
  spec: NodeSpec,
  knownBackends: IndexBackend[],
): IndexBackend[] | null {
  const supported = spec.supported_backends;
  if (supported === null) return null;
  const missing = knownBackends.filter((backend) => !supported.includes(backend));
  if (missing.length === 0) return null;
  return knownBackends.filter((backend) => supported.includes(backend));
}

/** Join backend ids into a human label (falls back to the id for unknown ones). */
export function backendSupportLabel(backends: IndexBackend[]): string {
  return backends.map((backend) => BACKEND_SHORT_LABELS[backend] ?? backend).join(", ");
}
