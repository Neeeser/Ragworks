"use client";

import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { FileGridView } from "@/components/files/FileGridView";
import { FileListView } from "@/components/files/FileListView";
import { FilePreviewPanel } from "@/components/files/FilePreviewPanel";
import { FilesHeader } from "@/components/files/FilesHeader";
import { useDragUploads } from "@/components/files/hooks/use-drag-uploads";
import { useFileActions } from "@/components/files/hooks/use-file-actions";
import { useFileTree } from "@/components/files/hooks/use-file-tree";
import { useFileUploads } from "@/components/files/hooks/use-file-uploads";
import { useViewMode } from "@/components/files/hooks/use-view-mode";
import {
  breadcrumbFor,
  childrenOfFolder,
  folderHref,
  resolveFolder,
} from "@/components/files/lib/tree";
import { NewFolderDialog } from "@/components/files/NewFolderDialog";
import { UploadTray } from "@/components/files/UploadTray";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { FileNode } from "@/lib/types";
import type { ChangeEvent } from "react";

type FilesBrowserProps = {
  token: string;
  collectionId: string;
  collectionName: string;
  /** Decoded folder path segments from the URL (empty = root). */
  pathSegments: string[];
};

type EntriesViewProps = {
  entries: FileNode[];
  token: string;
  viewMode: "list" | "grid";
  selectedFileId: string | null;
  expandedIds: Set<string>;
  animationKey: string;
  onToggleExpand: (node: FileNode) => void;
  onOpenFolder: (folder: FileNode | null) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
};

function EntriesView({
  entries,
  token,
  viewMode,
  selectedFileId,
  expandedIds,
  animationKey,
  onToggleExpand,
  onOpenFolder,
  onSelectFile,
  onRetry,
}: EntriesViewProps) {
  if (entries.length === 0) {
    return (
      <GlassCard className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-strong p-14 text-center">
        <UploadCloud className="h-8 w-8 text-muted" aria-hidden />
        <p className="text-sm text-body">
          Drop files or folders here, or use Upload to add your first file.
        </p>
      </GlassCard>
    );
  }
  if (viewMode === "grid") {
    return (
      <FileGridView
        entries={entries}
        selectedId={selectedFileId}
        onOpenFolder={onOpenFolder}
        onSelectFile={onSelectFile}
        onRetry={onRetry}
        animationKey={animationKey}
      />
    );
  }
  return (
    <FileListView
      entries={entries}
      token={token}
      selectedId={selectedFileId}
      expandedIds={expandedIds}
      onToggleExpand={onToggleExpand}
      onOpenFolder={onOpenFolder}
      onSelectFile={onSelectFile}
      onRetry={onRetry}
      animationKey={animationKey}
    />
  );
}

function BrowserNotices({ error, brokenPath }: { error: string | null; brokenPath: boolean }) {
  return (
    <>
      {error && (
        <p className="rounded-2xl border border-data-neg/40 bg-data-neg/10 p-3 text-sm text-body">
          {error}
        </p>
      )}
      {brokenPath && (
        <p className="rounded-2xl border border-hairline bg-surface p-3 text-sm text-muted">
          That folder no longer exists — showing the collection root.
        </p>
      )}
    </>
  );
}

/**
 * The collection's drive: URL-addressed folders, instant client-side
 * navigation over one fetched tree, list/grid views, drag-and-drop uploads,
 * and a preview panel.
 */
export function FilesBrowser({
  token,
  collectionId,
  collectionName,
  pathSegments,
}: FilesBrowserProps) {
  const router = useRouter();
  const tree = useFileTree(token, collectionId);
  const actions = useFileActions(token, collectionId, tree.refresh);
  const uploads = useFileUploads(token, collectionId, tree.refresh);
  const [viewMode, setViewMode] = useViewMode();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Resolve the URL's folder path against the loaded tree. `undefined` means
  // the path doesn't exist (deleted or mistyped) — treat as root once loaded.
  const currentFolder = useMemo(
    () => resolveFolder(tree.index, pathSegments),
    [pathSegments, tree.index],
  );
  const folder = currentFolder ?? null;
  const folderId = folder ? folder.id : null;
  const entries = childrenOfFolder(tree.index, folderId);
  const breadcrumb = useMemo(() => breadcrumbFor(tree.index, folder), [folder, tree.index]);
  const selectedFile = selectedFileId ? (tree.index.byId.get(selectedFileId) ?? null) : null;
  const brokenPath = !tree.initialLoading && pathSegments.length > 0 && currentFolder === undefined;
  const drag = useDragUploads((dropped) => uploads.enqueue(dropped, folderId));

  const navigate = (target: FileNode | null) => {
    setSelectedFileId(null);
    router.push(folderHref(collectionId, target));
  };

  const toggleExpand = (node: FileNode) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  };

  const onPickedFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    uploads.enqueue(
      files.map((file) => ({ file, relativePath: null })),
      folderId,
    );
    event.target.value = "";
  };

  if (tree.initialLoading) {
    return (
      <GlassCard className="flex items-center justify-center rounded-3xl p-10">
        <Loader className="h-6 w-6" />
      </GlassCard>
    );
  }

  return (
    <div {...drag.handlers} className="relative min-h-[60vh]">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1 space-y-4">
          <FilesHeader
            token={token}
            collectionId={collectionId}
            collectionName={collectionName}
            nodes={tree.nodes}
            breadcrumb={breadcrumb}
            viewMode={viewMode}
            uploading={uploads.uploading}
            onViewModeChange={setViewMode}
            onNavigate={navigate}
            onSelectFile={(file) => setSelectedFileId(file.id)}
            onNewFolder={() => setNewFolderOpen(true)}
            onPickFiles={() => fileInputRef.current?.click()}
          />

          <BrowserNotices error={tree.error ?? actions.error} brokenPath={brokenPath} />

          <EntriesView
            entries={entries}
            token={token}
            viewMode={viewMode}
            selectedFileId={selectedFileId}
            expandedIds={expandedIds}
            animationKey={folderId ?? "root"}
            onToggleExpand={toggleExpand}
            onOpenFolder={navigate}
            onSelectFile={(file) => setSelectedFileId(file.id)}
            onRetry={actions.retryIngestion}
          />
        </div>

        {selectedFile && (
          <FilePreviewPanel
            token={token}
            node={selectedFile}
            onClose={() => setSelectedFileId(null)}
            onRetry={actions.retryIngestion}
            onDelete={actions.deleteNode}
          />
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPickedFiles}
        aria-hidden
        tabIndex={-1}
      />

      {drag.dragActive && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-20 flex items-center justify-center",
            "rounded-3xl border-2 border-dashed border-accent-violet bg-accent-violet/10",
          )}
        >
          <p className="rounded-full border border-hairline bg-canvas-raised px-4 py-2 text-sm font-semibold text-primary">
            Drop to upload into {folder ? folder.name : collectionName}
          </p>
        </div>
      )}

      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreate={async (name) => (await actions.createFolder(name, folderId)) !== null}
      />
      <UploadTray items={uploads.items} onDismiss={uploads.dismiss} />
    </div>
  );
}
