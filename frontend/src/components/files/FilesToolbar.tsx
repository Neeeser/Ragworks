"use client";

import { FolderPlus, LayoutGrid, List, UploadCloud } from "lucide-react";
import { Fragment } from "react";

import { FileSearchBox } from "@/components/files/FileSearchBox";
import { ROOT_PARENT } from "@/components/files/lib/tree";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { ViewMode } from "@/components/files/hooks/use-view-mode";
import type { FileNode } from "@/lib/types";
import type { ReactNode } from "react";

type FilesToolbarProps = {
  token: string;
  collectionId: string;
  nodes: FileNode[];
  breadcrumb: FileNode[];
  viewMode: ViewMode;
  uploading: boolean;
  dnd: FileDnd;
  onViewModeChange: (mode: ViewMode) => void;
  onNavigate: (folder: FileNode | null) => void;
  onSelectFile: (file: FileNode) => void;
  onNewFolder: () => void;
  onPickFiles: () => void;
};

const VIEW_MODES: Array<{ mode: ViewMode; icon: typeof List; label: string }> = [
  { mode: "list", icon: List, label: "List view" },
  { mode: "grid", icon: LayoutGrid, label: "Grid view" },
];

type PathSegmentProps = {
  children: ReactNode;
  current: boolean;
  dropping: boolean;
  onNavigate: () => void;
  dropProps: ReturnType<FileDnd["dropProps"]>;
  ariaLabel?: string;
};

function PathSegment({
  children,
  current,
  dropping,
  onNavigate,
  dropProps,
  ariaLabel,
}: PathSegmentProps) {
  return (
    <button
      type="button"
      onClick={onNavigate}
      aria-label={ariaLabel}
      aria-current={current ? "page" : undefined}
      {...dropProps}
      className={cn(
        "max-w-40 shrink-0 truncate rounded-control px-1.5 py-0.5",
        "transition-colors duration-80 ease-standard focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
        current ? "text-primary" : "text-muted hover:bg-surface hover:text-primary",
        dropping && "bg-accent-violet/15 text-primary",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The browser's own toolbar: where you are in the tree, and what you can do
 * there.
 *
 * The path's root is `/`, not the collection's name — the breadcrumb above
 * already says which collection this is, twice, and what this row addresses is a
 * path *inside* it. `/reports/q3` is also literally the `path` the API stores and
 * the value the file tools resolve, so the row reads as the thing it navigates.
 * Every segment stays a drop target, so dragging a file onto `/` moves it to the
 * top level.
 */
export function FilesToolbar({
  token,
  collectionId,
  nodes,
  breadcrumb,
  viewMode,
  uploading,
  dnd,
  onViewModeChange,
  onNavigate,
  onSelectFile,
  onNewFolder,
  onPickFiles,
}: FilesToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
      <nav
        aria-label="Folder path"
        className="flex min-w-0 flex-1 items-center gap-0.5 font-mono text-ui"
      >
        {/* Toolbar tooltips open downward: this row is the card's top edge, and
            the card clips its own overflow, so a tooltip above it is cut off. */}
        <Tooltip content="Collection root" side="bottom">
          <PathSegment
            current={breadcrumb.length === 0}
            dropping={dnd.dropKey === ROOT_PARENT}
            onNavigate={() => onNavigate(null)}
            dropProps={dnd.dropProps(null)}
            ariaLabel="Collection root"
          >
            /
          </PathSegment>
        </Tooltip>
        {breadcrumb.map((crumb, position) => (
          <Fragment key={crumb.id}>
            {position > 0 ? (
              <span className="shrink-0 text-faint" aria-hidden>
                /
              </span>
            ) : null}
            <PathSegment
              current={position === breadcrumb.length - 1}
              dropping={dnd.dropKey === crumb.id}
              onNavigate={() => onNavigate(crumb)}
              dropProps={dnd.dropProps(crumb.id)}
            >
              {crumb.name}
            </PathSegment>
          </Fragment>
        ))}
      </nav>

      <FileSearchBox
        token={token}
        collectionId={collectionId}
        nodes={nodes}
        onOpenFolder={onNavigate}
        onSelectFile={onSelectFile}
      />

      <div
        role="group"
        aria-label="View mode"
        className="flex shrink-0 overflow-hidden rounded-control border border-hairline"
      >
        {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
          <Tooltip key={mode} content={label} side="bottom">
            <button
              type="button"
              onClick={() => onViewModeChange(mode)}
              aria-label={label}
              aria-pressed={viewMode === mode}
              className={cn(
                "flex h-7 w-8 items-center justify-center transition-colors duration-80 ease-standard",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                viewMode === mode
                  ? "bg-accent-violet/15 text-accent-violet"
                  : "text-muted hover:bg-surface hover:text-primary",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        ))}
      </div>

      <Button variant="secondary" size="sm" onClick={onNewFolder} className="shrink-0">
        <FolderPlus className="h-3.5 w-3.5" aria-hidden />
        New folder
      </Button>
      {/* The page's one primary action, so it is the only thing here that glows. */}
      <Button size="sm" glow onClick={onPickFiles} loading={uploading} className="shrink-0">
        <UploadCloud className="h-3.5 w-3.5" aria-hidden />
        Upload
      </Button>
    </div>
  );
}
