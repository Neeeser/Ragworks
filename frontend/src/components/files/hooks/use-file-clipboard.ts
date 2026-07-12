"use client";

import { useCallback, useState } from "react";

import type { FileNode } from "@/lib/types";

export type ClipboardMode = "copy" | "cut";

export interface FileClipboardItem {
  node: FileNode;
  mode: ClipboardMode;
}

export interface FileClipboard {
  item: FileClipboardItem | null;
  copy: (node: FileNode) => void;
  cut: (node: FileNode) => void;
  clear: () => void;
}

/** Page-scoped copy/cut clipboard for file-tree nodes. */
export function useFileClipboard(): FileClipboard {
  const [item, setItem] = useState<FileClipboardItem | null>(null);
  const copy = useCallback((node: FileNode) => setItem({ node, mode: "copy" }), []);
  const cut = useCallback((node: FileNode) => setItem({ node, mode: "cut" }), []);
  const clear = useCallback(() => setItem(null), []);
  return { item, copy, cut, clear };
}
