"use client";

import { useVirtualizer } from "@tanstack/react-virtual";

import { VirtualFileRow } from "@/components/files/VirtualFileRow";

import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { FileNode } from "@/lib/types";
import type { MouseEvent, RefObject } from "react";

/**
 * A collapsed row's height, in px — the virtualizer's starting guess before it
 * measures each row's real height off the DOM. Real rows vary (an expanded row
 * carries `FileRowDetails`, whose height depends on chunk count and arrives
 * after an async fetch), so this only has to be close enough that first paint
 * doesn't jump — `measureElement` corrects it per row.
 */
const ESTIMATED_ROW_HEIGHT = 45;

/** Rows mounted outside the visible window, on each side — enough that a fast
 * scroll or keyboard nav doesn't outrun measurement. */
const OVERSCAN = 8;

type FileVirtualRowsProps = {
  entries: FileNode[];
  token: string;
  selectedId: string | null;
  expandedIds: Set<string>;
  /** The scrolling ancestor the virtualizer measures its viewport against —
   * `FilesBrowser`'s "Folder contents" section, shared with `FileGridView`. */
  scrollElementRef: RefObject<HTMLElement | null>;
  onToggleExpand: (node: FileNode) => void;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  onContextMenu: (node: FileNode, event: MouseEvent) => void;
  dnd: FileDnd;
};

/**
 * Windows the row list to what's near the viewport, so a folder of thousands of
 * files mounts tens of DOM nodes rather than thousands.
 *
 * Row height is variable and measured, never assumed: each `VirtualFileRow`
 * reads its real rendered height off the DOM, including chunk detail that
 * mounts later — see that component's docstring for why a passive
 * `ResizeObserver` is not enough on its own and what closes the gap.
 * `measureElement` resolves which item it just measured by reading
 * `data-index` back off the DOM node (`@tanstack/virtual-core`'s
 * `indexAttribute` option) — every rendered row's root MUST carry a real
 * `data-index`, or measurement silently attributes to the wrong row and rows
 * overlap or jump.
 *
 * The row-separator hairline can't use CSS `:last-child`: only the rows near
 * the viewport are mounted, so whichever one happens to be the last DOM child
 * is a scroll-position accident, not the collection's actual last entry. The
 * true last entry is known from `entries` and compared by index instead.
 */
export function FileVirtualRows({
  entries,
  token,
  selectedId,
  expandedIds,
  scrollElementRef,
  onToggleExpand,
  onOpenFolder,
  onSelectFile,
  onRetry,
  onContextMenu,
  dnd,
}: FileVirtualRowsProps) {
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => entries[index]?.id ?? index,
  });

  const lastIndex = entries.length - 1;

  return (
    <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const node = entries[item.index];
        if (!node) {
          return null;
        }
        return (
          <VirtualFileRow
            key={item.key}
            node={node}
            index={item.index}
            start={item.start}
            isLast={item.index === lastIndex}
            measureElement={virtualizer.measureElement}
            resizeItem={virtualizer.resizeItem}
            token={token}
            selectedId={selectedId}
            expanded={expandedIds.has(node.id)}
            dnd={dnd}
            onToggleExpand={onToggleExpand}
            onOpenFolder={onOpenFolder}
            onSelectFile={onSelectFile}
            onRetry={onRetry}
            onContextMenu={onContextMenu}
          />
        );
      })}
    </ul>
  );
}
