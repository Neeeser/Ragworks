import { PineconeIcon } from "@/components/pipelines/icons/PineconeIcon";
import { PostgresIcon } from "@/components/pipelines/icons/PostgresIcon";

import type { IndexBackend } from "@/lib/types";

/** The official logo for a vector-store backend at inline-control size, so
 * index pickers can show where each index lives at a glance. */
export function IndexBackendIcon({
  backend,
  className = "h-4 w-4 shrink-0",
}: {
  backend: IndexBackend;
  className?: string;
}) {
  return backend === "pgvector" ? (
    <PostgresIcon className={className} />
  ) : (
    <PineconeIcon className={`${className} text-primary`} />
  );
}
