"use client";

import { ChevronRight, FolderPlus, LayoutGrid, List, UploadCloud } from "lucide-react";

import { FileSearchBox } from "@/components/files/FileSearchBox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ViewMode } from "@/components/files/hooks/use-view-mode";
import type { FileNode } from "@/lib/types";

type FilesHeaderProps = {
  token: string;
  collectionId: string;
  collectionName: string;
  nodes: FileNode[];
  breadcrumb: FileNode[];
  viewMode: ViewMode;
  uploading: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onNavigate: (folder: FileNode | null) => void;
  onSelectFile: (file: FileNode) => void;
  onNewFolder: () => void;
  onPickFiles: () => void;
};

const mutedLinkClass = "text-muted hover:text-primary";

export function FilesHeader({
  token,
  collectionId,
  collectionName,
  nodes,
  breadcrumb,
  viewMode,
  uploading,
  onViewModeChange,
  onNavigate,
  onSelectFile,
  onNewFolder,
  onPickFiles,
}: FilesHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Folder path" className="flex min-w-0 items-center gap-1 text-sm">
        <button
          type="button"
          onClick={() => onNavigate(null)}
          className={cn(
            "max-w-48 truncate rounded-xl px-2 py-1 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
            breadcrumb.length === 0 ? "text-primary" : mutedLinkClass,
          )}
        >
          {collectionName}
        </button>
        {breadcrumb.map((crumb, position) => (
          <span key={crumb.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <button
              type="button"
              onClick={() => onNavigate(crumb)}
              className={cn(
                "max-w-40 truncate rounded-xl px-2 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                position === breadcrumb.length - 1 ? "font-semibold text-primary" : mutedLinkClass,
              )}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
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
          className="flex overflow-hidden rounded-full border border-hairline"
        >
          {(
            [
              { mode: "list" as ViewMode, icon: List, label: "List view" },
              { mode: "grid" as ViewMode, icon: LayoutGrid, label: "Grid view" },
            ] as const
          ).map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onViewModeChange(mode)}
              aria-label={label}
              aria-pressed={viewMode === mode}
              className={cn(
                "flex h-9 w-10 items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                viewMode === mode ? "bg-accent-violet/15 text-accent-violet" : mutedLinkClass,
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onNewFolder}
          className="flex items-center gap-2"
        >
          <FolderPlus className="h-4 w-4" aria-hidden />
          New folder
        </Button>
        <Button
          size="sm"
          onClick={onPickFiles}
          loading={uploading}
          className="flex items-center gap-2"
        >
          <UploadCloud className="h-4 w-4" aria-hidden />
          Upload
        </Button>
      </div>
    </div>
  );
}
