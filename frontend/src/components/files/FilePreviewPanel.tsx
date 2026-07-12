"use client";

import { Download, RefreshCw, Route, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { FileIcon } from "@/components/files/FileIcon";
import { FilePreviewContent } from "@/components/files/FilePreviewContent";
import { IngestionBadge } from "@/components/files/IngestionBadge";
import { formatBytes } from "@/components/files/lib/tree";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { fetchFileBlob } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { useMediaQuery } from "@/lib/use-media-query";

import type { FileNode } from "@/lib/types";

type FilePreviewPanelProps = {
  token: string;
  node: FileNode;
  onClose: () => void;
  onRetry: (node: FileNode) => void;
  onDelete: (node: FileNode) => Promise<boolean>;
};

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

  const download = async () => {
    // Same authenticated-bytes path the preview uses; an <a href> can't
    // carry the Authorization header.
    const blob = await fetchFileBlob(token, node.id);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = node.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const metadata: Array<{ label: string; value: string }> = [
    { label: "Type", value: node.content_type || "unknown" },
    { label: "Size", value: formatBytes(node.size_bytes) },
    { label: "Path", value: node.path },
    {
      label: "Modified",
      value: formatDateTime(node.updated_at),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-hairline p-4">
        <div className="flex min-w-0 items-center gap-3">
          <FileIcon node={node} className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <h3
              id={titleId}
              className="truncate text-base font-semibold text-primary"
              title={node.name}
            >
              {node.name}
            </h3>
          </div>
          <IngestionBadge node={node} onRetry={onRetry} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline text-body transition hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <FilePreviewContent key={`${node.id}:${node.updated_at}`} token={token} node={node} />

        <dl className="grid grid-cols-2 gap-3">
          {metadata.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                {item.label}
              </dt>
              <dd className="mt-1 truncate text-sm text-primary" title={item.value}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        {ingestion?.status === "failed" && (
          <p className="rounded-2xl border border-data-neg/40 bg-data-neg/10 p-3 text-sm text-body">
            {ingestion.error_message ?? "Ingestion failed."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={download}
          className="flex items-center gap-2"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download
        </Button>
        {ingestion?.status !== "ready" &&
          ingestion?.status !== "processing" &&
          ingestion?.status !== "pending" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRetry(node)}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Ingest
            </Button>
          )}
        {ingestion?.ingestion_run_id && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/traces/documents/${ingestion.document_id}`)}
            className="flex items-center gap-2"
          >
            <Route className="h-3.5 w-3.5" aria-hidden />
            Trace
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmingDelete(true)}
          className="ml-auto flex items-center gap-2 text-data-neg"
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
 * File preview: a right-hand panel on desktop, a fullscreen overlay (with an
 * X) below the `lg` breakpoint.
 */
export function FilePreviewPanel(props: FilePreviewPanelProps) {
  const titleId = useId();
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);

  if (isDesktop) {
    return (
      <aside
        aria-labelledby={titleId}
        className="sticky top-6 hidden max-h-[calc(100vh-6rem)] w-[380px] shrink-0 overflow-hidden rounded-3xl border border-hairline bg-surface lg:block"
      >
        <PanelBody {...props} titleId={titleId} />
      </aside>
    );
  }

  return (
    <ModalOverlay open onClose={props.onClose} labelledBy={titleId}>
      <div className="flex h-[100dvh] w-screen flex-col bg-canvas">
        <PanelBody {...props} titleId={titleId} />
      </div>
    </ModalOverlay>
  );
}
