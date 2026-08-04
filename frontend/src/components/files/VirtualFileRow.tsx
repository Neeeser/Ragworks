"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

import { FileEntryRow } from "@/components/files/FileEntryRow";
import { cn } from "@/lib/utils";

import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { FileNode } from "@/lib/types";
import type { MouseEvent } from "react";

type VirtualFileRowProps = {
  node: FileNode;
  index: number;
  start: number;
  isLast: boolean;
  /** `virtualizer.measureElement` — stable across renders (bound once when
   * the `Virtualizer` instance is constructed). Used only as the mount-time
   * ref callback; see `remeasure` below for why later calls use
   * `resizeItem` instead. */
  measureElement: (node: HTMLLIElement | null) => void;
  /** `virtualizer.resizeItem` — also stable; writes a size straight into the
   * measurement cache. */
  resizeItem: (index: number, size: number) => void;
  token: string;
  selectedId: string | null;
  expanded: boolean;
  dnd: FileDnd;
  onToggleExpand: (node: FileNode) => void;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  onContextMenu: (node: FileNode, event: MouseEvent) => void;
};

/**
 * One virtualized row: the measured, positioned `<li>`, plus an explicit
 * remeasure whenever this row's own content is about to change shape.
 *
 * `ResizeObserver` alone is not a sufficient trigger. It's still attached
 * (via `measureElement`, wired through the merged ref below) and handles
 * resizes from causes this component doesn't know about, but its
 * notifications are delivered as part of the browser's rendering pipeline —
 * which is exactly what's skipped or delayed for a document that isn't
 * currently visible to the compositor (a backgrounded tab, or — verified
 * live against this app — an automated browser session driving a
 * non-foregrounded page). In that state a row's real DOM height changes on
 * expand, `getBoundingClientRect` proves it, and `ResizeObserver` simply
 * never notifies: every row after it stays laid out at the stale size,
 * visibly overlapping the grown content.
 *
 * `useLayoutEffect` runs synchronously right after this row's DOM commits,
 * so `remeasure` can read the real, current `offsetHeight` with no
 * dependency on that pipeline at all. It deliberately calls `resizeItem`,
 * not `measureElement`: `measureElement`'s own default implementation
 * (`@tanstack/virtual-core`) short-circuits to whatever size is *already
 * cached* whenever it's invoked without a real `ResizeObserverEntry` —
 * exactly the case for every call after the first mount — so calling it a
 * second time here would silently return the stale collapsed height instead
 * of reading the DOM again. `resizeItem` writes a size straight into the
 * cache with no such check. This covers both known shape changes: expanding
 * /collapsing here, and (via `onContentResize`, threaded into
 * `FileRowDetails`) its chunk list settling from a loading skeleton to real
 * content after its own async fetch.
 */
export function VirtualFileRow({
  node,
  index,
  start,
  isLast,
  measureElement,
  resizeItem,
  token,
  selectedId,
  expanded,
  dnd,
  onToggleExpand,
  onOpenFolder,
  onSelectFile,
  onRetry,
  onContextMenu,
}: VirtualFileRowProps) {
  const liRef = useRef<HTMLLIElement | null>(null);

  const setRefs = useCallback(
    (el: HTMLLIElement | null) => {
      liRef.current = el;
      measureElement(el);
    },
    [measureElement],
  );

  const remeasure = useCallback(() => {
    if (liRef.current) {
      resizeItem(index, liRef.current.offsetHeight);
    }
  }, [index, resizeItem]);

  useLayoutEffect(() => {
    remeasure();
  }, [expanded, remeasure]);

  return (
    <li
      data-index={index}
      ref={setRefs}
      className={cn("border-hairline", isLast ? "border-b-0" : "border-b")}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${start}px)`,
      }}
    >
      <FileEntryRow
        node={node}
        token={token}
        selected={node.id === selectedId}
        expanded={expanded}
        dnd={dnd}
        onToggleExpand={onToggleExpand}
        onOpenFolder={onOpenFolder}
        onSelectFile={onSelectFile}
        onRetry={onRetry}
        onContextMenu={onContextMenu}
        onContentResize={remeasure}
      />
    </li>
  );
}
