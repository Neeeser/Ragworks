"use client";

import { FileVirtualRows } from "@/components/files/FileVirtualRows";
import { COL, COLUMN_WIDTHS } from "@/components/files/lib/file-columns";
import { DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { FileNode } from "@/lib/types";
import type { MouseEvent, ReactNode, RefObject } from "react";

/**
 * Sticky, because the pane it sits in scrolls: a column header that scrolls away
 * leaves a long tree as six unlabelled columns of numbers.
 */
function ColumnHeader() {
  return (
    <div className="sticky top-0 z-10 bg-canvas-raised">
      <DataRowHeader
        title="Name"
        columns={[
          <InstrumentLabel key="status" className={COL.status}>
            Status
          </InstrumentLabel>,
          <InstrumentLabel key="type" className={COL.type}>
            Type
          </InstrumentLabel>,
          <InstrumentLabel key="size" className={COL.size}>
            Size
          </InstrumentLabel>,
          <InstrumentLabel key="chunks" className={COL.chunks}>
            Chunks
          </InstrumentLabel>,
          <InstrumentLabel key="tokens" className={COL.tokens}>
            Tokens
          </InstrumentLabel>,
          <InstrumentLabel key="updated" className={COL.updated}>
            Modified
          </InstrumentLabel>,
        ]}
      />
    </div>
  );
}

type FileListViewProps = {
  entries: FileNode[];
  token: string;
  selectedId: string | null;
  expandedIds: Set<string>;
  loading: boolean;
  /** The scrolling ancestor the row virtualizer measures against — shared with
   * `FileGridView`, owned by `FilesBrowser`. */
  scrollElementRef: RefObject<HTMLElement | null>;
  onToggleExpand: (node: FileNode) => void;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  onContextMenu: (node: FileNode, event: MouseEvent) => void;
  dnd: FileDnd;
  /** Rendered in place of rows when the folder is empty. */
  emptyState: ReactNode;
};

/**
 * One row per entry, with the facts a tree view is read for on the same line:
 * derived ingestion state, content type, size, indexed chunks and tokens, and
 * when the node last changed.
 *
 * The header renders in every state — loading, empty, and populated — so the
 * columns never appear or disappear under the user, and the skeleton stands at
 * the rows' final geometry rather than as a spinner of a different size. The
 * populated state is windowed by `FileVirtualRows` rather than mapped directly,
 * so a folder of thousands of files mounts only the rows near the viewport.
 */
export function FileListView({
  entries,
  token,
  selectedId,
  expandedIds,
  loading,
  scrollElementRef,
  onToggleExpand,
  onOpenFolder,
  onSelectFile,
  onRetry,
  onContextMenu,
  dnd,
  emptyState,
}: FileListViewProps) {
  return (
    <>
      <ColumnHeader />
      {loading ? (
        <DataRowSkeleton rows={6} columnWidths={COLUMN_WIDTHS} label="Loading files" />
      ) : entries.length === 0 ? (
        emptyState
      ) : (
        <FileVirtualRows
          entries={entries}
          token={token}
          selectedId={selectedId}
          expandedIds={expandedIds}
          scrollElementRef={scrollElementRef}
          onToggleExpand={onToggleExpand}
          onOpenFolder={onOpenFolder}
          onSelectFile={onSelectFile}
          onRetry={onRetry}
          onContextMenu={onContextMenu}
          dnd={dnd}
        />
      )}
    </>
  );
}
