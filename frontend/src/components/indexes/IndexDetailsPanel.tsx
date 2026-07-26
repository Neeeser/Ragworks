"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { Readout } from "@/components/ui/readout";
import { Tooltip } from "@/components/ui/tooltip";

import type { VectorIndex } from "@/lib/types";

type IndexDetailsPanelProps = {
  index: VectorIndex | null;
  onDelete: (name: string) => void;
  /** Adopt an index the store holds but the registry does not know. */
  onRegister: (index: VectorIndex) => void;
  registering?: boolean;
};

/** Read-only detail card for the selected vector index, plus the entry points into
 * the delete-confirmation and registration flows (both owned by the parent
 * IndexRegistryModal). */
export function IndexDetailsPanel({
  index,
  onDelete,
  onRegister,
  registering,
}: IndexDetailsPanelProps) {
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
          <Readout label="Registered">{index.registered ? "Yes" : "No"}</Readout>
          {index.host ? (
            <Readout label="Host" className="w-full">
              {index.host}
            </Readout>
          ) : null}
          {index.registered ? (
            <div className="w-full">
              <InstrumentLabel>Used by</InstrumentLabel>
              {index.in_use_by && index.in_use_by.length > 0 ? (
                // Each user links to the collection that owns the choice: this
                // panel reports who points here, it never repoints them.
                <ul className="mt-1 space-y-0.5">
                  {index.in_use_by.map((usage) => (
                    <li key={`${usage.collection_id}-${usage.pipeline_id}-${usage.role}`}>
                      <Link
                        href={`/collections/${usage.collection_id}`}
                        className="rounded-control text-ui text-body transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                      >
                        {usage.collection_name}
                      </Link>
                      <span className="text-instrument text-meta">
                        {" · "}
                        {usage.pipeline_name} ({usage.role})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-ui text-muted">Nothing points at this index.</p>
              )}
            </div>
          ) : (
            <div className="w-full space-y-2">
              <p className="max-w-[66ch] text-ui text-muted">
                This index exists in the store but is not registered, so no pipeline can select it.
                Register it to make it available.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRegister(index)}
                loading={registering}
              >
                Register index
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="p-8 text-center text-ui text-muted">Select an index to see its details.</p>
      )}
    </Panel>
  );
}
