// Pure helpers over the flat node list the tree endpoint returns. Navigation
// is a client-side lookup against this index — zero network per folder change.

import type { FileNode } from "@/lib/types";

export const ROOT_PARENT = "__root__";

export interface TreeIndex {
  byId: Map<string, FileNode>;
  childrenOf: Map<string, FileNode[]>;
}

function parentKey(node: FileNode): string {
  return node.parent_id ?? ROOT_PARENT;
}

/** Sort folders before files, then case-insensitive by name. */
export function compareNodes(a: FileNode, b: FileNode): number {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function buildTreeIndex(nodes: FileNode[]): TreeIndex {
  const byId = new Map<string, FileNode>();
  const childrenOf = new Map<string, FileNode[]>();
  for (const node of nodes) {
    byId.set(node.id, node);
    const key = parentKey(node);
    const siblings = childrenOf.get(key);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenOf.set(key, [node]);
    }
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort(compareNodes);
  }
  return { byId, childrenOf };
}

export function childrenOfFolder(index: TreeIndex, folderId: string | null): FileNode[] {
  return index.childrenOf.get(folderId ?? ROOT_PARENT) ?? [];
}

/** Resolve URL path segments to the folder they name (null = root). */
export function resolveFolder(index: TreeIndex, segments: string[]): FileNode | null | undefined {
  let current: FileNode | null = null;
  for (const segment of segments) {
    const children = childrenOfFolder(index, current?.id ?? null);
    const next = children.find((node) => node.kind === "folder" && node.name === segment);
    if (!next) {
      return undefined; // broken path
    }
    current = next;
  }
  return current;
}

/** Ancestors of a folder, root-first (the breadcrumb). */
export function breadcrumbFor(index: TreeIndex, folder: FileNode | null): FileNode[] {
  const crumbs: FileNode[] = [];
  let cursor: FileNode | null = folder;
  while (cursor) {
    crumbs.push(cursor);
    cursor = cursor.parent_id ? (index.byId.get(cursor.parent_id) ?? null) : null;
  }
  return crumbs.reverse();
}

/** Build the files-page href for a folder path (segments URL-encoded). */
export function folderHref(collectionId: string, folder: FileNode | null): string {
  const base = `/collections/${collectionId}/files`;
  if (!folder) {
    return base;
  }
  const segments = folder.path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  return `${base}/${segments.join("/")}`;
}

export function isProcessing(node: FileNode): boolean {
  const status = node.ingestion?.status;
  return status === "pending" || status === "processing";
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(size: number): string {
  if (size <= 0) {
    return "0 B";
  }
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = size / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
}
