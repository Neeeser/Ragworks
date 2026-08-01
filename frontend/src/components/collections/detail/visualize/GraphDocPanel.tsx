"use client";

import { Route, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Readout } from "@/components/ui/readout";
import { Tooltip } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

import type { Document, InsightDocPoint } from "@/lib/types";

export type GraphNeighbor = {
  point: InsightDocPoint;
  similarity: number;
  collisionCount: number;
};

type GraphDocPanelProps = {
  point: InsightDocPoint;
  /** The full document record, when the collection listing has resolved. */
  document: Document | null;
  /** This document's ties, strongest first. */
  neighbors: GraphNeighbor[];
  onSelectNeighbor: (point: InsightDocPoint) => void;
  onClose: () => void;
};

function NeighborRow({ neighbor, onSelect }: { neighbor: GraphNeighbor; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-baseline gap-2 rounded-control px-1.5 py-1 text-left hover:bg-surface-strong"
      >
        <span
          className={cn(
            "shrink-0 font-mono text-instrument tabular-nums",
            neighbor.collisionCount > 0 ? "text-data-neg" : "text-body",
          )}
        >
          {neighbor.similarity.toFixed(3)}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui text-primary">
          {neighbor.point.document_name}
        </span>
        {neighbor.collisionCount > 0 ? (
          <span className="shrink-0 font-mono text-instrument tabular-nums text-data-neg">
            {neighbor.collisionCount}⇄
          </span>
        ) : null}
      </button>
    </li>
  );
}

function PanelBody({
  point,
  document,
  neighbors,
  onSelectNeighbor,
  onClose,
  titleId,
}: GraphDocPanelProps & { titleId: string }) {
  const router = useRouter();
  const traceHref = document?.ingestion_run_id ? `/traces/documents/${document.id}` : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <Tooltip content={point.document_name} side="bottom" triggerClassName="min-w-0 flex-1">
          <h3 id={titleId} className="w-full truncate text-ui font-medium text-primary">
            {point.document_name}
          </h3>
        </Tooltip>
        <Tooltip content="Close document details" side="left">
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close document details">
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-3 py-2">
        <Readout label="Chunks">{point.chunk_count.toLocaleString()}</Readout>
        {document ? (
          <>
            <Readout label="Tokens">{document.num_tokens.toLocaleString()}</Readout>
            <Readout label="Status">{document.status}</Readout>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <InstrumentLabel>Nearest documents</InstrumentLabel>
        {neighbors.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {neighbors.map((neighbor) => (
              <NeighborRow
                key={neighbor.point.document_id}
                neighbor={neighbor}
                onSelect={() => onSelectNeighbor(neighbor.point)}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-ui text-muted">No similarity ties to other documents.</p>
        )}
        {neighbors.some((neighbor) => neighbor.collisionCount > 0) ? (
          <p className="mt-2 max-w-[40ch] text-instrument text-muted">
            Red counts are near-duplicate chunk pairs shared with that document — the Overlaps tab
            lists them.
          </p>
        ) : null}
      </div>

      {traceHref ? (
        <div className="flex shrink-0 items-center border-t border-hairline px-3 py-2">
          <Tooltip content="Open this document's ingestion trace" side="top">
            <Button variant="secondary" size="sm" onClick={() => router.push(traceHref)}>
              <Route className="h-3.5 w-3.5" aria-hidden />
              View trace
            </Button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The selected graph node's document: chunk footprint, its strongest ties
 * (clickable, so the graph can be walked without aiming at small nodes), and
 * the route to the ingestion trace that produced it. Docked beside the plot on
 * desktop; a fullscreen overlay below `lg`, mirroring `ChunkDetailPanel`.
 */
export function GraphDocPanel(props: GraphDocPanelProps) {
  const titleId = useId();
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);

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
