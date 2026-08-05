"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { FileNode } from "@/lib/types";

type FailedFilesNoticeProps = {
  nodes: FileNode[];
  onRetry: () => Promise<boolean>;
};

/** Files whose ingestion failed and which are therefore not in the index. */
export function countFailedFiles(nodes: FileNode[]): number {
  return nodes.filter((node) => node.kind === "file" && node.ingestion?.status === "failed").length;
}

/**
 * A one-line notice when files failed to ingest, with the action that retries
 * all of them.
 *
 * The per-file retry on the badge is the answer for one bad document; a
 * provider outage fails every upload in flight, and clearing that one X at a
 * time is the friction this removes. Like the stale notice, it costs embedding
 * calls, so it stays a button.
 */
export function FailedFilesNotice({ nodes, onRetry }: FailedFilesNoticeProps) {
  const [busy, setBusy] = useState(false);
  const count = countFailedFiles(nodes);
  if (count === 0) {
    return null;
  }
  const label =
    count === 1
      ? "1 file failed to ingest and is not in the index."
      : `${count} files failed to ingest and are not in the index.`;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
      <p className="min-w-0 flex-1 text-ui text-data-neg">{label}</p>
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        className="shrink-0"
        onClick={() => {
          setBusy(true);
          void onRetry().finally(() => setBusy(false));
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Retry failed files
      </Button>
    </div>
  );
}
