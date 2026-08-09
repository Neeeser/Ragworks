"use client";

import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { FileIcon } from "@/components/files/FileIcon";
import { FileRowDetails } from "@/components/files/FileRowDetails";
import { COL, NUMERIC_CELL } from "@/components/files/lib/file-columns";
import { fileStatus } from "@/components/files/lib/file-status";
import { Button } from "@/components/ui/button";
import { DataRow } from "@/components/ui/data-row";
import { PulseWire } from "@/components/ui/pulse-wire";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatBytes, formatTimeAgoCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { FileDnd } from "@/components/files/hooks/use-file-dnd";
import type { FileStatus } from "@/components/files/lib/file-status";
import type { FileNode } from "@/lib/types";
import type { MouseEvent, ReactNode } from "react";

/**
 * The derived ingestion state, plus the pulse while a pipeline is actually
 * moving this file's data.
 *
 * The wire runs only on `live` states, and the tree polls for exactly as long
 * as one of them exists — so the light stops when the work does. Anything
 * settled (ready, failed, never eligible) gets the dot and the word alone.
 */
function statusCell(node: FileNode, status: FileStatus | null): ReactNode {
  if (!status) {
    return <span key="status" className={COL.status} />;
  }
  return (
    <Tooltip
      key="status"
      content={status.detail}
      side="bottom"
      triggerClassName={cn(COL.status, "items-center gap-2")}
    >
      <StatusDot tone={status.tone} label={status.label} />
      {status.live ? (
        <PulseWire label={`Ingesting ${node.name}`} className="min-w-0 flex-1" />
      ) : null}
    </Tooltip>
  );
}

/** The file's content type — a literal, so it renders verbatim in mono. */
function typeCell(node: FileNode): ReactNode {
  if (node.kind === "folder") {
    return (
      <span key="type" className={cn(COL.type, "truncate text-ui text-muted")}>
        Folder
      </span>
    );
  }
  if (!node.content_type) {
    return (
      <span key="type" className={cn(COL.type, "text-ui text-muted")}>
        —
      </span>
    );
  }
  return (
    <Tooltip key="type" content={node.content_type} side="bottom" triggerClassName={COL.type}>
      <span className="block w-full truncate font-mono text-ui text-muted">
        {node.content_type}
      </span>
    </Tooltip>
  );
}

function sizeCell(node: FileNode): ReactNode {
  return (
    <span key="size" className={cn(COL.size, NUMERIC_CELL)}>
      {node.kind === "folder" ? (
        <span className="text-muted">—</span>
      ) : (
        formatBytes(node.size_bytes)
      )}
    </span>
  );
}

function numericCell(width: string, value: number | null, key: string): ReactNode {
  return (
    <span key={key} className={cn(width, NUMERIC_CELL)}>
      {value === null ? <span className="text-muted">—</span> : value.toLocaleString()}
    </span>
  );
}

/**
 * Every metadata column for one entry, in header order.
 *
 * Chunk and token counts appear only for a `ready` file: an ingestion record that
 * is still pending carries zeros, and printing those would claim the file was
 * indexed as nothing.
 */
function rowColumns(node: FileNode): ReactNode[] {
  const ingestion = node.ingestion;
  const ready = ingestion !== null && ingestion !== undefined && ingestion.status === "ready";
  return [
    statusCell(node, fileStatus(node)),
    typeCell(node),
    sizeCell(node),
    numericCell(COL.chunks, ready ? ingestion.num_chunks : null, "chunks"),
    numericCell(COL.tokens, ready ? ingestion.num_tokens : null, "tokens"),
    <Tooltip
      key="updated"
      content={parseApiDate(node.updated_at)?.toLocaleString() ?? ""}
      side="left"
      triggerClassName={COL.updated}
    >
      <span className="font-mono text-ui tabular-nums text-meta">
        {formatTimeAgoCompact(node.updated_at)}
      </span>
    </Tooltip>,
  ];
}

type RowActionsProps = {
  node: FileNode;
  status: FileStatus | null;
  expandable: boolean;
  expanded: boolean;
  onRetry: (file: FileNode) => void;
  onToggleExpand: (node: FileNode) => void;
};

/**
 * The row's own buttons, rendered as a sibling of the activatable row body —
 * never inside it, because a button nested in a button is invalid HTML and
 * shipped here once as a hydration error.
 *
 * Their tooltips open to the left. The tree pane scrolls, and a scroll container
 * clips both axes, so a tooltip on a control at the pane's right edge is cut in
 * half by the seam it sits against.
 */
function RowActions({
  node,
  status,
  expandable,
  expanded,
  onRetry,
  onToggleExpand,
}: RowActionsProps) {
  return (
    <>
      {status?.retryable ? (
        <Tooltip content="Run ingestion on this file" side="left">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Ingest ${node.name}`}
            onClick={() => onRetry(node)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      ) : null}
      {expandable ? (
        <Tooltip content={expanded ? "Hide chunks" : "Show chunks"} side="left">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} chunks in ${node.name}`}
            onClick={() => onToggleExpand(node)}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        </Tooltip>
      ) : null}
    </>
  );
}

/**
 * Why a file is not in the index, as the row's second line.
 *
 * Both terminal not-indexed states carry a message, and a user should not have
 * to open anything to read it — `failed` names what went wrong, `unsupported`
 * names the pipeline that reads none of this file's formats. Nothing else gets
 * a subtitle: a placeholder second line would make every row taller for no
 * information.
 */
function outcomeSubtitle(ingestion: FileNode["ingestion"]): string | undefined {
  if (ingestion?.status === "failed") {
    return ingestion.error_message ?? "Ingestion failed.";
  }
  // Unsupported is the state a user is most likely to want explained: the
  // label alone says the file is out, not which pipeline decided or why.
  if (ingestion?.status === "unsupported") {
    return ingestion.error_message ?? "This pipeline does not read this file type.";
  }
  return undefined;
}

type FileEntryRowProps = {
  node: FileNode;
  token: string;
  selected: boolean;
  expanded: boolean;
  dnd: FileDnd;
  onToggleExpand: (node: FileNode) => void;
  onOpenFolder: (folder: FileNode) => void;
  onSelectFile: (file: FileNode) => void;
  onRetry: (file: FileNode) => void;
  onContextMenu: (node: FileNode, event: MouseEvent) => void;
  /** Forwarded to `FileRowDetails` — see its docstring. */
  onContentResize?: () => void;
};

/**
 * One entry: a `DataRow`, its drag/drop wrapper, and its expanded chunk detail.
 *
 * Renders as a fragment rather than owning its own list-item element: the
 * virtualized list (`FileVirtualRows`) supplies the measured, positioned `<li>`
 * this content sits inside, so the row separator and the measurement ref both
 * live one level up.
 */
export function FileEntryRow({
  node,
  token,
  selected,
  expanded,
  dnd,
  onToggleExpand,
  onOpenFolder,
  onSelectFile,
  onRetry,
  onContextMenu,
  onContentResize,
}: FileEntryRowProps) {
  const ingestion = node.ingestion;

  return (
    <>
      {/* Only the row is draggable — the expanded chunk text below it has to
          stay selectable. */}
      <div
        {...dnd.dragProps(node)}
        {...(node.kind === "folder" ? dnd.dropProps(node.id) : {})}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(node, event);
        }}
        className={cn(
          "transition-colors duration-80 ease-standard",
          dnd.draggingId === node.id && "opacity-40",
          dnd.dropKey === node.id && "bg-accent-violet/15",
        )}
      >
        <DataRow
          className="border-b-0"
          selected={selected}
          onSelect={() => (node.kind === "folder" ? onOpenFolder(node) : onSelectFile(node))}
          title={
            <>
              <FileIcon node={node} className="mr-2 inline-block h-3.5 w-3.5 align-[-0.15em]" />
              {node.name}
            </>
          }
          subtitle={outcomeSubtitle(ingestion)}
          columns={rowColumns(node)}
          actions={
            <RowActions
              node={node}
              status={fileStatus(node)}
              expandable={Boolean(ingestion)}
              expanded={expanded}
              onRetry={onRetry}
              onToggleExpand={onToggleExpand}
            />
          }
        />
      </div>
      {expanded && ingestion ? (
        <FileRowDetails ingestion={ingestion} token={token} onContentResize={onContentResize} />
      ) : null}
    </>
  );
}
