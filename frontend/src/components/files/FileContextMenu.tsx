"use client";

import {
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  FolderOpen,
  FolderPlus,
  PenLine,
  Scissors,
  Trash2,
} from "lucide-react";

import { canDropInto } from "@/components/files/lib/tree";
import { ContextMenu } from "@/components/ui/context-menu";

import type { FileClipboard } from "@/components/files/hooks/use-file-clipboard";
import type { TreeIndex } from "@/components/files/lib/tree";
import type { ContextMenuItem, ContextMenuPosition } from "@/components/ui/context-menu";
import type { FileNode } from "@/lib/types";

export type FileMenuTarget = {
  position: ContextMenuPosition;
  /** The right-clicked node; null = the folder background. */
  node: FileNode | null;
};

type FileContextMenuProps = {
  target: FileMenuTarget | null;
  clipboard: FileClipboard;
  index: TreeIndex;
  /** Folder the browser is currently showing (null = root). */
  currentFolderId: string | null;
  onClose: () => void;
  onOpen: (node: FileNode) => void;
  onDownload: (node: FileNode) => void;
  onPaste: (parentId: string | null) => void;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
  onNewFolder: () => void;
};

/**
 * Right-click actions for the files browser: Finder-style Copy / Cut /
 * Paste / Rename / Delete on nodes, New folder + Paste on the background.
 */
export function FileContextMenu({
  target,
  clipboard,
  index,
  currentFolderId,
  onClose,
  onOpen,
  onDownload,
  onPaste,
  onRename,
  onDelete,
  onNewFolder,
}: FileContextMenuProps) {
  if (!target) {
    return <ContextMenu position={null} items={[]} onClose={onClose} />;
  }

  const { node } = target;
  // Paste lands in the right-clicked folder, otherwise the current folder.
  const pasteParentId = node?.kind === "folder" ? node.id : currentFolderId;
  const held = clipboard.item;
  // A copy is always legal (names dedupe); a cut is a move, so no-op and
  // into-own-subtree drops are rejected up front.
  const canPaste =
    held !== null && (held.mode === "copy" || canDropInto(index, held.node, pasteParentId));
  const pasteItem: ContextMenuItem = {
    label: "Paste",
    icon: ClipboardPaste,
    disabled: !canPaste,
    hint: held ? held.node.name : undefined,
    onSelect: () => {
      onPaste(pasteParentId);
    },
  };

  const items: ContextMenuItem[] = node
    ? [
        node.kind === "folder"
          ? { label: "Open", icon: FolderOpen, onSelect: () => onOpen(node) }
          : { label: "Preview", icon: Eye, onSelect: () => onOpen(node) },
        ...(node.kind === "file"
          ? [{ label: "Download", icon: Download, onSelect: () => onDownload(node) }]
          : []),
        { type: "separator" as const },
        { label: "Copy", icon: Copy, onSelect: () => clipboard.copy(node) },
        { label: "Cut", icon: Scissors, onSelect: () => clipboard.cut(node) },
        ...(node.kind === "folder" ? [pasteItem] : []),
        { type: "separator" as const },
        { label: "Rename", icon: PenLine, onSelect: () => onRename(node) },
        { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(node) },
      ]
    : [{ label: "New folder", icon: FolderPlus, onSelect: onNewFolder }, pasteItem];

  return <ContextMenu position={target.position} items={items} onClose={onClose} />;
}
