"use client";

import { Download, RefreshCw, Route, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { FileIcon } from "@/components/files/FileIcon";
import { FilePreviewContent } from "@/components/files/FilePreviewContent";
import { downloadFileNode } from "@/components/files/lib/download";
import { fileStatus } from "@/components/files/lib/file-status";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { PulseWire } from "@/components/ui/pulse-wire";
import { Readout } from "@/components/ui/readout";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatBytes, formatTimeAgoCompact } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";

import type { FileStatus } from "@/components/files/lib/file-status";
import type { FileNode } from "@/lib/types";

type FilePreviewPanelProps = {
  token: string;
  node: FileNode;
  onClose: () => void;
  onRetry: (node: FileNode) => void;
  onDelete: (node: FileNode) => Promise<boolean>;
};

function TimeReadout({ label, value }: { label: string; value: string }) {
  return (
    <Tooltip content={parseApiDate(value)?.toLocaleString() ?? ""}>
      <Readout label={label}>{formatTimeAgoCompact(value)}</Readout>
    </Tooltip>
  );
}

type PreviewHeaderProps = {
  node: FileNode;
  status: FileStatus | null;
  titleId: string;
  onClose: () => void;
};

/**
 * The pane's identity row: what the file is called, what state it is in, and
 * the way out. Below it, the pulse — but only while a pipeline is moving this
 * file's data, and the tree polls for exactly that long, so the wire stops
 * when the work does.
 */
function PreviewHeader({ node, status, titleId, onClose }: PreviewHeaderProps) {
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <FileIcon node={node} className="h-3.5 w-3.5 shrink-0" />
        <Tooltip content={node.name} triggerClassName="min-w-0 flex-1">
          <h3 id={titleId} className="w-full truncate text-ui font-medium text-primary">
            {node.name}
          </h3>
        </Tooltip>
        {/* These two open left. The pane is the browser card's right edge and
            the card clips its own overflow, so a centred tooltip on a control
            this close to the seam is cut in half by it. */}
        {status ? (
          <Tooltip content={status.detail} side="left" triggerClassName="shrink-0">
            <StatusDot tone={status.tone} label={status.label} />
          </Tooltip>
        ) : null}
        <Tooltip content="Close preview" side="left">
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close preview">
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      </div>
      {status?.live ? (
        <PulseWire label={`Ingesting ${node.name}`} className="w-full shrink-0" />
      ) : null}
    </>
  );
}

function PanelBody({
  token,
  node,
  onClose,
  onRetry,
  onDelete,
  titleId,
}: FilePreviewPanelProps & { titleId: string }) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ingestion = node.ingestion;
  const status = fileStatus(node);
  const ready = ingestion?.status === "ready";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewHeader node={node} status={status} titleId={titleId} onClose={onClose} />

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-3 py-2">
        {node.content_type ? (
          <Tooltip content={node.content_type}>
            <Readout label="Type">{node.content_type}</Readout>
          </Tooltip>
        ) : (
          <Readout label="Type">
            <span className="text-muted">—</span>
          </Readout>
        )}
        <Readout label="Size">{formatBytes(node.size_bytes)}</Readout>
        <Readout label="Chunks">
          {ready ? ingestion.num_chunks.toLocaleString() : <span className="text-muted">—</span>}
        </Readout>
        <Readout label="Tokens">
          {ready ? ingestion.num_tokens.toLocaleString() : <span className="text-muted">—</span>}
        </Readout>
        <TimeReadout label="Modified" value={node.updated_at} />
        <TimeReadout label="Created" value={node.created_at} />
        <Tooltip content={node.path} triggerClassName="w-full">
          <Readout label="Path" className="min-w-0 flex-1">
            {node.path}
          </Readout>
        </Tooltip>
      </div>

      {ingestion?.status === "failed" && (
        <p className="shrink-0 border-b border-hairline px-3 py-2 text-ui text-data-neg">
          {ingestion.error_message ?? "Ingestion failed."}
        </p>
      )}

      {ingestion?.warnings.length ? (
        <div className="shrink-0 border-b border-hairline px-3 py-2">
          <InstrumentLabel className="text-data-warn">Ingestion warnings</InstrumentLabel>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-ui text-body marker:text-data-warn">
            {ingestion.warnings.map((warning, index) => (
              <li key={`${index}:${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <FilePreviewContent key={`${node.id}:${node.updated_at}`} token={token} node={node} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-hairline px-3 py-2">
        <Button variant="secondary" size="sm" onClick={() => downloadFileNode(token, node)}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download
        </Button>
        {status?.retryable && (
          <Button variant="secondary" size="sm" onClick={() => onRetry(node)}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Ingest
          </Button>
        )}
        {ingestion?.ingestion_run_id && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/traces/documents/${ingestion.document_id}`)}
          >
            <Route className="h-3.5 w-3.5" aria-hidden />
            Trace
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmingDelete(true)}
          className="ml-auto text-data-neg hover:text-data-neg"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${node.name}?`}
        description="Removes the file, its chunks, and its indexed vectors. This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          const removed = await onDelete(node);
          setDeleting(false);
          setConfirmingDelete(false);
          if (removed) {
            onClose();
          }
        }}
      />
    </div>
  );
}

/**
 * The selected file's inspector: a pane docked to the right of the tree inside
 * the browser card, sharing its material and separated from it by a hairline
 * seam, and owning its own scroll.
 *
 * Not a floating card — this is a working surface the user reads a file's bytes
 * in, so it gets the full height of the browser and the tree keeps scrolling
 * independently beside it. Below `lg` there is no room for two panes, so it
 * becomes a fullscreen overlay with the same body.
 */
export function FilePreviewPanel(props: FilePreviewPanelProps) {
  const titleId = useId();
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);

  if (isDesktop) {
    return (
      <aside
        aria-labelledby={titleId}
        className="hidden w-[380px] shrink-0 border-l border-hairline lg:block"
      >
        <PanelBody {...props} titleId={titleId} />
      </aside>
    );
  }

  return (
    <ModalOverlay open onClose={props.onClose} labelledBy={titleId}>
      <div className="flex h-[100dvh] w-screen flex-col bg-canvas-raised">
        <PanelBody {...props} titleId={titleId} />
      </div>
    </ModalOverlay>
  );
}
