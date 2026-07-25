"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { Readout } from "@/components/ui/readout";
import { Tooltip } from "@/components/ui/tooltip";

import type { VectorIndex } from "@/lib/types";

type IndexDetailsPanelProps = {
  index: VectorIndex | null;
  onDelete: (name: string) => void;
};

/** Read-only detail card for the selected vector index, plus the entry point into
 * the delete-confirmation flow (owned by the parent IndexManagerModal). */
export function IndexDetailsPanel({ index, onDelete }: IndexDetailsPanelProps) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex h-8 items-center justify-between gap-2 border-b border-hairline pl-3 pr-1">
        <InstrumentLabel>Index details</InstrumentLabel>
        <Tooltip content="Delete index" side="left">
          <Button
            size="sm"
            variant="ghost"
            className="hover:text-data-neg"
            onClick={() => index && onDelete(index.name)}
            disabled={!index}
            aria-label="Delete index"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      </div>
      {index ? (
        // One instrument readout rather than seven bordered cells: a set of
        // small facts about one selected thing is a row, not a grid of boxes.
        <div className="flex flex-wrap gap-x-4 gap-y-1 p-3">
          <Readout label="Name">{index.name}</Readout>
          <Readout label="Status">
            {(index.status as { state?: string } | null)?.state ?? "Unknown"}
          </Readout>
          <Readout label="Backend">
            {index.backend === "pgvector" ? "pgvector" : "Pinecone"}
          </Readout>
          <Readout label="Vector type">{index.vector_type ?? "dense"}</Readout>
          <Readout label="Dimension">
            {index.dimension ?? <span className="text-muted">—</span>}
          </Readout>
          <Readout label="Metric">{index.metric ?? "cosine"}</Readout>
          {index.host ? (
            <Readout label="Host" className="w-full">
              {index.host}
            </Readout>
          ) : null}
        </div>
      ) : (
        <p className="p-8 text-center text-ui text-muted">Select an index to see its details.</p>
      )}
    </Panel>
  );
}
