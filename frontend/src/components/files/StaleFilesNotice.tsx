"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { FileNode } from "@/lib/types";

type StaleFilesNoticeProps = {
  nodes: FileNode[];
  onReingest: () => Promise<boolean>;
};

/** Files indexed by an older version of the current ingestion pipeline. */
export function countStaleFiles(nodes: FileNode[]): number {
  return nodes.filter(
    (node) => node.kind === "file" && node.ingestion?.status === "ready" && node.ingestion.stale,
  ).length;
}

/**
 * A one-line notice when ready files predate the bound ingestion pipeline's
 * current version, with the action that clears it. Re-ingestion re-runs the
 * pipeline on every out-of-date file, which costs embedding calls — so it is
 * a button here, never automatic.
 */
export function StaleFilesNotice({ nodes, onReingest }: StaleFilesNoticeProps) {
  const [busy, setBusy] = useState(false);
  const count = countStaleFiles(nodes);
  if (count === 0) {
    return null;
  }
  const label =
    count === 1
      ? "1 file was ingested with an older version of the ingestion pipeline."
      : `${count} files were ingested with an older version of the ingestion pipeline.`;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
      <p className="min-w-0 flex-1 text-ui text-data-warn">{label}</p>
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        className="shrink-0"
        onClick={() => {
          setBusy(true);
          void onReingest().finally(() => setBusy(false));
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Re-ingest out-of-date files
      </Button>
    </div>
  );
}
