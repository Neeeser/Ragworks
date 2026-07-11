"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import { FileIcon } from "@/components/files/FileIcon";
import { FileRowDetails } from "@/components/files/FileRowDetails";
import { IngestionBadge } from "@/components/files/IngestionBadge";
import { formatBytes } from "@/components/files/lib/tree";
import { cn } from "@/lib/utils";

import type { FileNode } from "@/lib/types";

type FileListViewProps = {
  entries: FileNode[];
  token: string;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggleExpand: (node: FileNode) => void;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  animationKey: string;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Finder-style rows; a chevron on ingested files expands chunk details. */
export function FileListView({
  entries,
  token,
  selectedId,
  expandedIds,
  onToggleExpand,
  onOpenFolder,
  onSelectFile,
  onRetry,
  animationKey,
}: FileListViewProps) {
  return (
    <div key={animationKey} className="overflow-hidden rounded-3xl border border-hairline">
      <div className="hidden items-center gap-3 border-b border-hairline bg-surface px-4 py-2 sm:flex">
        <span className="w-9" />
        <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Name
        </span>
        <span className="w-8" />
        <span className="w-20 text-right font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Size
        </span>
        <span className="hidden w-20 text-right font-mono text-[11px] uppercase tracking-[0.28em] text-muted md:block">
          Chunks
        </span>
        <span className="hidden w-28 text-right font-mono text-[11px] uppercase tracking-[0.28em] text-muted lg:block">
          Modified
        </span>
      </div>
      <ul>
        {entries.map((node, position) => {
          const expanded = expandedIds.has(node.id);
          const expandable = node.kind === "file" && Boolean(node.ingestion);
          return (
            <li
              key={node.id}
              className="files-rise border-b border-hairline last:border-b-0"
              style={{ animationDelay: `${Math.min(position, 20) * 18}ms` }}
            >
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition",
                  node.id === selectedId ? "bg-accent-violet/10" : "hover:bg-surface",
                )}
              >
                {expandable ? (
                  <button
                    type="button"
                    onClick={() => onToggleExpand(node)}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name} details`}
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline",
                      "text-body transition hover:border-strong focus-visible:outline-none",
                      "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                      expanded && "border-accent-violet text-accent-violet",
                    )}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                ) : (
                  <span className="w-9 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => (node.kind === "folder" ? onOpenFolder(node) : onSelectFile(node))}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none",
                    "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  )}
                >
                  <FileIcon node={node} className="h-4.5 w-4.5 shrink-0" />
                  <span className="truncate text-sm text-primary" title={node.name}>
                    {node.name}
                  </span>
                </button>
                <span className="flex w-8 justify-center">
                  <IngestionBadge node={node} onRetry={onRetry} />
                </span>
                <span className="w-20 text-right text-xs text-muted">
                  {node.kind === "folder" ? "—" : formatBytes(node.size_bytes)}
                </span>
                <span className="hidden w-20 text-right text-xs text-muted md:block">
                  {node.ingestion?.status === "ready" ? node.ingestion.num_chunks : "—"}
                </span>
                <span className="hidden w-28 text-right text-xs text-muted lg:block">
                  {formatDate(node.updated_at)}
                </span>
              </div>
              {expanded && node.ingestion && (
                <FileRowDetails node={node} ingestion={node.ingestion} token={token} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
