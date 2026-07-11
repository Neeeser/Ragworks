"use client";

import { FileIcon } from "@/components/files/FileIcon";
import { IngestionBadge } from "@/components/files/IngestionBadge";
import { formatBytes } from "@/components/files/lib/tree";
import { cn } from "@/lib/utils";

import type { FileNode } from "@/lib/types";

type FileGridViewProps = {
  entries: FileNode[];
  selectedId: string | null;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  animationKey: string;
};

/** Drive-style tile grid; folders open, files preview. */
export function FileGridView({
  entries,
  selectedId,
  onOpenFolder,
  onSelectFile,
  onRetry,
  animationKey,
}: FileGridViewProps) {
  return (
    <div
      key={animationKey}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {entries.map((node, position) => (
        <button
          key={node.id}
          type="button"
          onClick={() => (node.kind === "folder" ? onOpenFolder(node) : onSelectFile(node))}
          className={cn(
            "files-rise group flex flex-col items-start gap-3 rounded-3xl border p-4 text-left transition",
            node.id === selectedId
              ? "border-accent-violet bg-accent-violet/10"
              : "border-hairline bg-surface hover:border-strong hover:bg-surface-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
          style={{ animationDelay: `${Math.min(position, 20) * 22}ms` }}
        >
          <div className="flex w-full items-start justify-between gap-2">
            <FileIcon node={node} className="h-7 w-7" />
            <IngestionBadge node={node} onRetry={onRetry} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-primary" title={node.name}>
              {node.name}
            </p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-meta">
              {node.kind === "folder" ? "Folder" : formatBytes(node.size_bytes)}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
