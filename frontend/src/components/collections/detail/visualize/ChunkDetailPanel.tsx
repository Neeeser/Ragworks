"use client";

import { Maximize2, Route, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Readout } from "@/components/ui/readout";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import { prettyJson, truncate } from "@/lib/utils";

import type { ChunkDetail, InsightPoint } from "@/lib/types";

type ChunkDetailPanelProps = {
  detail: ChunkDetail | null;
  loading: boolean;
  selectedPoint: InsightPoint | null;
  errorMessage: string | null;
  onClose: () => void;
  onExpand?: () => void;
};

/** The pane's geometry while the selected point's chunk loads. */
function DetailSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="mt-3 space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

type ChunkBodyProps = {
  detail: ChunkDetail;
  onExpand?: () => void;
};

function ChunkBody({ detail, onExpand }: ChunkBodyProps) {
  const router = useRouter();
  const { chunk, document } = detail;
  const indexedAt = parseApiDate(chunk.created_at);
  // Trace focus ids are positional (`{document_id}:{chunk_index}`), not the
  // chunk row's UUID — the UUID resolves to "chunk no longer exists".
  const traceHref = document.ingestion_run_id
    ? `/traces/documents/${document.id}?chunk=${document.id}:${chunk.chunk_index}`
    : null;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-3 py-2">
        <Readout label="Chunk">{`#${chunk.chunk_index + 1}`}</Readout>
        <Readout label="Strategy">{chunk.chunk_strategy}</Readout>
        <Readout label="Size">
          {chunk.chunk_size.toLocaleString()}
          <span className="text-muted"> tokens</span>
        </Readout>
        {/* This pane is the card's right edge and the card clips its own
            overflow, so tooltips here open inward. */}
        <Tooltip content={indexedAt?.toLocaleString() ?? ""} side="left">
          <Readout label="Indexed">{formatTimeAgoCompact(chunk.created_at)}</Readout>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <InstrumentLabel>Chunk text</InstrumentLabel>
        <p className="mt-1 max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-body">
          {truncate(chunk.text, 600)}
        </p>

        <InstrumentLabel className="mt-4 block">Metadata</InstrumentLabel>
        <pre className="mt-1 max-h-56 overflow-auto rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-body">
          {prettyJson(chunk.metadata)}
        </pre>
      </div>

      {onExpand || traceHref ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-3 py-2">
          {traceHref ? (
            <Tooltip content="Open the ingestion trace focused on this chunk" side="top">
              <Button variant="secondary" size="sm" onClick={() => router.push(traceHref)}>
                <Route className="h-3.5 w-3.5" aria-hidden />
                View trace
              </Button>
            </Tooltip>
          ) : null}
          {onExpand ? (
            <Button variant="ghost" size="sm" onClick={onExpand}>
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              Expand
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function PanelBody({
  detail,
  loading,
  errorMessage,
  onClose,
  onExpand,
  titleId,
}: Omit<ChunkDetailPanelProps, "selectedPoint"> & { titleId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <Tooltip
          content={detail?.document.name ?? ""}
          side="bottom"
          triggerClassName="min-w-0 flex-1"
        >
          <h3 id={titleId} className="w-full truncate text-ui font-medium text-primary">
            {detail ? detail.document.name : "Chunk"}
          </h3>
        </Tooltip>
        <Tooltip content="Close chunk details" side="left">
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close chunk details">
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      </div>

      {loading ? <DetailSkeleton /> : null}

      {!loading && errorMessage ? (
        <p className="px-3 py-2 text-ui text-data-neg">{errorMessage}</p>
      ) : null}

      {!loading && !errorMessage && !detail ? (
        <p className="px-3 py-2 text-ui text-muted">No chunk details available.</p>
      ) : null}

      {!loading && !errorMessage && detail ? (
        <ChunkBody detail={detail} onExpand={onExpand} />
      ) : null}
    </div>
  );
}

/**
 * The selected point's chunk: a pane docked to the right of the plot inside the
 * same card, sharing its material and separated from it by a hairline seam.
 *
 * It exists only while a point is selected, so an unused plane never spends a
 * third of the plot's width on a prompt. Below `lg` there is no room for two
 * panes, so the same body becomes a fullscreen overlay.
 */
export function ChunkDetailPanel({ selectedPoint, ...props }: ChunkDetailPanelProps) {
  const titleId = useId();
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);

  if (!selectedPoint) {
    return null;
  }

  if (isDesktop) {
    return (
      <aside
        aria-labelledby={titleId}
        className="hidden w-[340px] shrink-0 border-l border-hairline bg-surface lg:block"
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
