// The ingestion state a file's own rows can honestly support, in the backend's
// vocabulary. Derived rather than invented: a `FileNode` has no status field —
// what it has is the presence or absence of a `Document` record and that
// record's `DocumentStatus`, and those two facts mean different things.

import type { StatusTone } from "@/components/ui/status-dot";
import type { FileNode } from "@/lib/types";

export interface FileStatus {
  tone: StatusTone;
  /** Rendered through `InstrumentLabel`, so it reads as the backend's enum word. */
  label: string;
  /** One sentence for the hover tooltip: what the state means for this file. */
  detail: string;
  /** Whether asking the API to ingest this file again is meaningful. */
  retryable: boolean;
  /**
   * Whether a pipeline is moving this file's data right now — the pulse's
   * licence. The tree polls while any file is in this state, so a pulsing row
   * is depicting work that is genuinely in flight, not decorating an idle one.
   */
  live: boolean;
}

function chunkPhrase(count: number): string {
  return `${count} ${count === 1 ? "chunk" : "chunks"}`;
}

/**
 * A file's ingestion state, or `null` for a folder (which has none).
 *
 * The three distinctions the file tree's contract actually draws, and which the
 * row has to keep separate:
 *
 * - **No document record** is not a failure — the file is stored, it was simply
 *   never pipeline-eligible. Uploads always persist; the content-type list only
 *   gates auto-ingestion, so forcing an ingest is meaningful and the parser's
 *   own error is the honest outcome.
 * - **`failed` always carries an `error_message`**, so the detail is the real
 *   reason rather than a generic sentence.
 * - **`unsupported` is terminal but not a failure** — the collection's pipeline
 *   reads none of this file's formats, so it offers no retry: what changes the
 *   outcome is a parse node, not another run.
 * - **`ready` means indexed chunks**, so the count belongs in the detail: a
 *   ready file with warnings was still indexed, and the warning is about *how*.
 */
export function fileStatus(node: FileNode): FileStatus | null {
  if (node.kind !== "file") {
    return null;
  }
  const ingestion = node.ingestion;
  if (!ingestion) {
    return {
      tone: "neutral",
      label: "Not indexed",
      detail:
        "No document record — the ingestion pipeline does not accept this content type. Ingest it anyway to see the parser's own result.",
      retryable: true,
      live: false,
    };
  }
  switch (ingestion.status) {
    case "ready":
      if (ingestion.stale) {
        return {
          tone: "warn",
          label: "Out of date",
          detail:
            "Indexed with an older version of the ingestion pipeline. Re-ingest to apply the current version.",
          retryable: true,
          live: false,
        };
      }
      return ingestion.warnings.length > 0
        ? {
            tone: "warn",
            label: "Ready",
            detail: `Indexed as ${chunkPhrase(ingestion.num_chunks)}, with ${
              ingestion.warnings.length === 1
                ? "1 warning"
                : `${ingestion.warnings.length} warnings`
            }.`,
            retryable: false,
            live: false,
          }
        : {
            tone: "pos",
            label: "Ready",
            detail: `Indexed as ${chunkPhrase(ingestion.num_chunks)}.`,
            retryable: false,
            live: false,
          };
    case "pending":
      return {
        tone: "active",
        label: "Pending",
        detail: "Queued for ingestion.",
        retryable: false,
        live: true,
      };
    case "processing":
      return {
        tone: "active",
        label: "Processing",
        detail: "Being parsed, chunked, and indexed now.",
        retryable: false,
        live: true,
      };
    case "failed":
      return {
        tone: "neg",
        label: "Failed",
        detail: ingestion.error_message ?? "Ingestion failed.",
        retryable: true,
        live: false,
      };
    case "unsupported":
      return {
        tone: "neutral",
        label: "Unsupported",
        detail:
          ingestion.error_message ??
          "No parse node in this collection's ingestion pipeline reads this file type.",
        // Rerunning the same graph over the same bytes reaches the same
        // answer, so the file waits on a pipeline change, not on a retry.
        retryable: false,
        live: false,
      };
  }
}
