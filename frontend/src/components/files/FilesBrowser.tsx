"use client";

import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { FileContextMenu } from "@/components/files/FileContextMenu";
import { FileGridView } from "@/components/files/FileGridView";
import { FileListView } from "@/components/files/FileListView";
import { FilePreviewPanel } from "@/components/files/FilePreviewPanel";
import { FilesHeader } from "@/components/files/FilesHeader";
import { useDragUploads } from "@/components/files/hooks/use-drag-uploads";
import { useFileActions } from "@/components/files/hooks/use-file-actions";
import { useFileClipboard } from "@/components/files/hooks/use-file-clipboard";
import { useFileDnd } from "@/components/files/hooks/use-file-dnd";
import { useFileTree } from "@/components/files/hooks/use-file-tree";
import { useFileUploads } from "@/components/files/hooks/use-file-uploads";
import { useViewMode } from "@/components/files/hooks/use-view-mode";
import { downloadFileNode } from "@/components/files/lib/download";
import {
  breadcrumbFor,
  childrenOfFolder,
  folderHref,
  resolveFolder,
} from "@/components/files/lib/tree";
import { NewFolderDialog } from "@/components/files/NewFolderDialog";
import { RenameDialog } from "@/components/files/RenameDialog";
import { UploadTray } from "@/components/files/UploadTray";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

import type { FileMenuTarget } from "@/components/files/FileContextMenu";
import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { FileNode } from "@/lib/types";
import type { ChangeEvent, MouseEvent } from "react";

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
  dnd: FileDnd;
  onToggleExpand: (node: FileNode) => void;
  onOpenFolder: (folder: FileNode | null) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  onContextMenu: (node: FileNode, event: MouseEvent) => void;
};

function EntriesView({
  entries,
  token,
  viewMode,
  selectedFileId,
  expandedIds,
  animationKey,
  dnd,
  onToggleExpand,
  onOpenFolder,
  onSelectFile,
  onRetry,
  onContextMenu,
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
        onContextMenu={onContextMenu}
        dnd={dnd}
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
      onContextMenu={onContextMenu}
      dnd={dnd}
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
 * navigation over one fetched tree, list/grid views, drag-and-drop uploads
 * and rearranging, right-click actions, and a preview panel.
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
  const clipboard = useFileClipboard();
  const [viewMode, setViewMode] = useViewMode();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<FileMenuTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
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

  const { moveNode } = actions;
  const onDndMove = useCallback(
    (node: FileNode, parentId: string | null) => {
      void moveNode(node, parentId);
    },
    [moveNode],
  );
  const dnd = useFileDnd(tree.index, onDndMove);

  const navigate = (target: FileNode | null) => {
    setSelectedFileId(null);
    router.push(folderHref(collectionId, target));
  };

  const openNode = (node: FileNode) =>
    node.kind === "folder" ? navigate(node) : setSelectedFileId(node.id);

  const openMenu = (node: FileNode | null, event: MouseEvent) => {
    setMenuTarget({ position: { x: event.clientX, y: event.clientY }, node });
  };

  const paste = (parentId: string | null) => {
    const held = clipboard.item;
    if (!held) return;
    if (held.mode === "copy") {
      void actions.copyNode(held.node, parentId);
    } else {
      void actions.moveNode(held.node, parentId);
      clipboard.clear();
    }
  };

  const download = (node: FileNode) => {
    setDownloadError(null);
    downloadFileNode(token, node).catch((err) =>
      setDownloadError(getErrorMessage(err, "Unable to download.")),
    );
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const deleted = await actions.deleteNode(deleteTarget);
    setDeleting(false);
    if (deleted) {
      if (clipboard.item?.node.id === deleteTarget.id) {
        clipboard.clear();
      }
      if (selectedFileId === deleteTarget.id) {
        setSelectedFileId(null);
      }
      setDeleteTarget(null);
    }
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
            dnd={dnd}
            onViewModeChange={setViewMode}
            onNavigate={navigate}
            onSelectFile={(file) => setSelectedFileId(file.id)}
            onNewFolder={() => setNewFolderOpen(true)}
            onPickFiles={() => fileInputRef.current?.click()}
          />

          <BrowserNotices
            error={tree.error ?? actions.error ?? downloadError}
            brokenPath={brokenPath}
          />

          <div
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(null, event);
            }}
          >
            <EntriesView
              entries={entries}
              token={token}
              viewMode={viewMode}
              selectedFileId={selectedFileId}
              expandedIds={expandedIds}
              animationKey={folderId ?? "root"}
              dnd={dnd}
              onToggleExpand={toggleExpand}
              onOpenFolder={navigate}
              onSelectFile={(file) => setSelectedFileId(file.id)}
              onRetry={actions.retryIngestion}
              onContextMenu={openMenu}
            />
          </div>
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

      <FileContextMenu
        target={menuTarget}
        clipboard={clipboard}
        index={tree.index}
        currentFolderId={folderId}
        onClose={() => setMenuTarget(null)}
        onOpen={openNode}
        onDownload={download}
        onPaste={paste}
        onRename={setRenameTarget}
        onDelete={setDeleteTarget}
        onNewFolder={() => setNewFolderOpen(true)}
      />
      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreate={async (name) => (await actions.createFolder(name, folderId)) !== null}
      />
      <RenameDialog
        node={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={actions.renameNode}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.name ?? ""}?`}
        description={
          deleteTarget?.kind === "folder"
            ? "The folder, everything inside it, and any indexed chunks will be removed."
            : "The file and any indexed chunks will be removed."
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <UploadTray items={uploads.items} onDismiss={uploads.dismiss} />
    </div>
  );
}
