"use client";

import { FileIcon } from "@/components/files/FileIcon";
import { IngestionBadge } from "@/components/files/IngestionBadge";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { FileNode } from "@/lib/types";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

type FileGridViewProps = {
  entries: FileNode[];
  selectedId: string | null;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  onContextMenu: (node: FileNode, event: MouseEvent) => void;
  dnd: FileDnd;
  /** Rendered in place of tiles when the folder is empty. */
  emptyState: ReactNode;
};

/**
 * The alternate tile view, kept because a file browser's grid is a real
 * affordance and the choice is persisted per browser. Tiles are dense and
 * hairline-bordered rather than card-like: the list is the default and this is
 * the same information at a glanceable size, not a brochure of it.
 */
export function FileGridView({
  entries,
  selectedId,
  onOpenFolder,
  onSelectFile,
  onRetry,
  onContextMenu,
  dnd,
  emptyState,
}: FileGridViewProps) {
  const activate = (node: FileNode) =>
    node.kind === "folder" ? onOpenFolder(node) : onSelectFile(node);

  if (entries.length === 0) {
    return <div className="bg-canvas-raised">{emptyState}</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-2 bg-canvas-raised p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {entries.map((node) => (
        // A div with button semantics, not a <button>: the ingestion badge
        // inside is itself a button (retry), and buttons can't nest.
        <div
          key={node.id}
          role="button"
          tabIndex={0}
          aria-label={node.name}
          onClick={() => activate(node)}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              activate(node);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onContextMenu(node, event);
          }}
          {...dnd.dragProps(node)}
          {...(node.kind === "folder" ? dnd.dropProps(node.id) : {})}
          className={cn(
            "flex cursor-pointer flex-col items-start gap-2 rounded-control border p-3 text-left",
            "transition-colors duration-80 ease-standard",
            node.id === selectedId
              ? "border-accent-violet bg-accent-violet/10"
              : "border-hairline bg-surface hover:border-strong hover:bg-surface-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            dnd.draggingId === node.id && "opacity-40",
            dnd.dropKey === node.id && "border-accent-violet bg-accent-violet/15",
          )}
        >
          <div className="flex w-full items-start justify-between gap-2">
            <FileIcon node={node} className="h-5 w-5" />
            <IngestionBadge node={node} onRetry={onRetry} />
          </div>
          <div className="min-w-0 max-w-full">
            <p className="truncate text-ui font-medium text-primary">{node.name}</p>
            <p className="mt-0.5 font-mono text-instrument tabular-nums text-meta">
              {node.kind === "folder" ? "Folder" : formatBytes(node.size_bytes)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
