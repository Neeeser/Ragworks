"use client";

import { FileIcon } from "@/components/files/FileIcon";
import { IngestionBadge } from "@/components/files/IngestionBadge";
import { formatBytes } from "@/components/files/lib/tree";
import { cn } from "@/lib/utils";

import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { FileNode } from "@/lib/types";
import type { KeyboardEvent, MouseEvent } from "react";

type FileGridViewProps = {
  entries: FileNode[];
  selectedId: string | null;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  onContextMenu: (node: FileNode, event: MouseEvent) => void;
  dnd: FileDnd;
  animationKey: string;
};

/** Drive-style tile grid; folders open, files preview. */
export function FileGridView({
  entries,
  selectedId,
  onOpenFolder,
  onSelectFile,
  onRetry,
  onContextMenu,
  dnd,
  animationKey,
}: FileGridViewProps) {
  const activate = (node: FileNode) =>
    node.kind === "folder" ? onOpenFolder(node) : onSelectFile(node);

  return (
    <div
      key={animationKey}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {entries.map((node, position) => (
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
            "files-rise group flex cursor-pointer flex-col items-start gap-3 rounded-3xl border p-4 text-left transition",
            node.id === selectedId
              ? "border-accent-violet bg-accent-violet/10"
              : "border-hairline bg-surface hover:border-strong hover:bg-surface-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            dnd.draggingId === node.id && "opacity-40",
            dnd.dropKey === node.id && "border-accent-violet bg-accent-violet/15",
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
        </div>
      ))}
    </div>
  );
}
