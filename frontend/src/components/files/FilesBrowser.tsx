"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { FileContextMenu } from "@/components/files/FileContextMenu";
import { FileGridView } from "@/components/files/FileGridView";
import { FileListView } from "@/components/files/FileListView";
import { FilePreviewPanel } from "@/components/files/FilePreviewPanel";
import { FilesEmptyState } from "@/components/files/FilesEmptyState";
import { FilesToolbar } from "@/components/files/FilesToolbar";
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
import { StaleFilesNotice } from "@/components/files/StaleFilesNotice";
import { UploadTray } from "@/components/files/UploadTray";
import { PageBody } from "@/components/ui/app-shell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Panel } from "@/components/ui/panel";
import { getErrorMessage } from "@/lib/errors";

import type { FileMenuTarget } from "@/components/files/FileContextMenu";
import type { FileNode } from "@/lib/types";
import type { ChangeEvent, MouseEvent } from "react";

type FilesBrowserProps = {
  token: string;
  collectionId: string;
  collectionName: string;
  /** Decoded folder path segments from the URL (empty = root). */
  pathSegments: string[];
};

function BrowserNotices({ error, brokenPath }: { error: string | null; brokenPath: boolean }) {
  return (
    <>
      {error && (
        <p className="shrink-0 border-b border-hairline px-3 py-2 text-ui text-data-neg">{error}</p>
      )}
      {brokenPath && (
        <p className="shrink-0 border-b border-hairline px-3 py-2 text-ui text-muted">
          That folder no longer exists — showing the collection root.
        </p>
      )}
    </>
  );
}

type DeleteNodeDialogProps = {
  /** The node awaiting confirmation; null keeps the dialog closed. */
  node: FileNode | null;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Deleting a folder takes its subtree and their chunks with it, so it says so. */
function DeleteNodeDialog({ node, deleting, onConfirm, onCancel }: DeleteNodeDialogProps) {
  return (
    <ConfirmDialog
      open={node !== null}
      title={`Delete ${node?.name ?? ""}?`}
      description={
        node?.kind === "folder"
          ? "The folder, everything inside it, and any indexed chunks will be removed."
          : "The file and any indexed chunks will be removed."
      }
      confirmLabel="Delete"
      confirmVariant="danger"
      loading={deleting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/** Where an OS-file drop will land, shown only while a drag is over the browser. */
function DropTarget({ folderName }: { folderName: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-panel border-2 border-dashed border-accent-violet bg-accent-violet/10"
    >
      <p className="rounded-control border border-hairline bg-canvas-raised px-3 py-1.5 text-ui font-medium text-primary">
        Drop to upload into {folderName}
      </p>
    </div>
  );
}

/**
 * The collection's drive: URL-addressed folders, instant client-side navigation
 * over one fetched tree, list/grid views, drag-and-drop uploads and rearranging,
 * right-click actions, and a docked preview pane.
 *
 * The whole browser is one card — toolbar, entries, and preview share a single
 * elevated surface, separated by hairlines rather than by their own backgrounds,
 * because they are one object and not three stacked ones. The tree and the
 * preview each own their scroll, so reading a file's bytes never moves the row
 * you selected it from.
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
  // The list view's virtualizer measures its viewport against this element —
  // the same scrolling section `FileGridView` renders unvirtualized tiles into.
  const scrollElementRef = useRef<HTMLElement | null>(null);

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

  const pickFiles = () => fileInputRef.current?.click();
  const selectFile = (file: FileNode) => setSelectedFileId(file.id);
  const emptyState = <FilesEmptyState onPickFiles={pickFiles} />;

  return (
    <PageBody className="flex flex-col">
      <Panel {...drag.handlers} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <FilesToolbar
          token={token}
          collectionId={collectionId}
          nodes={tree.nodes}
          breadcrumb={breadcrumb}
          viewMode={viewMode}
          uploading={uploads.uploading}
          dnd={dnd}
          onViewModeChange={setViewMode}
          onNavigate={navigate}
          onSelectFile={selectFile}
          onNewFolder={() => setNewFolderOpen(true)}
          onPickFiles={pickFiles}
        />

        <BrowserNotices
          error={tree.error ?? actions.error ?? downloadError}
          brokenPath={brokenPath}
        />
        <StaleFilesNotice nodes={tree.nodes} onReingest={actions.reingestStale} />

        <div className="flex min-h-0 flex-1">
          {/* Entries sit directly on the card's own material — a background of
              their own would nest a second surface inside the card. Named,
              because the page has two panes and a screen reader user needs to
              move between them. */}
          <section
            ref={scrollElementRef}
            aria-label="Folder contents"
            className="min-w-0 flex-1 overflow-y-auto"
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(null, event);
            }}
          >
            {viewMode === "grid" ? (
              <FileGridView
                entries={entries}
                selectedId={selectedFileId}
                onOpenFolder={navigate}
                onSelectFile={selectFile}
                onRetry={actions.retryIngestion}
                onContextMenu={openMenu}
                dnd={dnd}
                emptyState={emptyState}
              />
            ) : (
              <FileListView
                entries={entries}
                token={token}
                selectedId={selectedFileId}
                expandedIds={expandedIds}
                loading={tree.initialLoading}
                scrollElementRef={scrollElementRef}
                onToggleExpand={toggleExpand}
                onOpenFolder={navigate}
                onSelectFile={selectFile}
                onRetry={actions.retryIngestion}
                onContextMenu={openMenu}
                dnd={dnd}
                emptyState={emptyState}
              />
            )}
          </section>

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

        {drag.dragActive && <DropTarget folderName={folder ? folder.name : collectionName} />}
      </Panel>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPickedFiles}
        aria-hidden
        tabIndex={-1}
      />

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
      <DeleteNodeDialog
        node={deleteTarget}
        deleting={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <UploadTray items={uploads.items} onDismiss={uploads.dismiss} />
    </PageBody>
  );
}
