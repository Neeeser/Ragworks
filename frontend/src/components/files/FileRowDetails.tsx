"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  sortChunks,
  type ChunkSortDirection,
  type ChunkSortField,
} from "@/components/files/lib/chunk-sort";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Readout } from "@/components/ui/readout";
import { Skeleton } from "@/components/ui/skeleton";
import { SortControl } from "@/components/ui/sort-control";
import { Tooltip } from "@/components/ui/tooltip";
import { fetchDocumentChunks } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { truncate } from "@/lib/utils";

import type { FileIngestion, FileNode } from "@/lib/types";

type FileRowDetailsProps = {
  node: FileNode;
  ingestion: FileIngestion;
  token: string;
};

const SORT_FIELDS: ChunkSortField[] = ["chunk_number", "ingestion_time", "tokens"];

function isSortField(value: string): value is ChunkSortField {
  return (SORT_FIELDS as string[]).includes(value);
}

function ChunkSkeleton() {
  return (
    <div aria-busy>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 border-b border-hairline px-3 py-2">
          <Skeleton className="h-1.5 w-1.5 rounded-full" />
          <Skeleton className="h-2 w-16" />
          <Skeleton className="h-2 flex-1" />
        </div>
      ))}
      <span className="sr-only">Loading chunks</span>
    </div>
  );
}

/**
 * The expanded row: how this file was chunked and stored, then the chunks
 * themselves. Every value the ingestion record carries is here, because this is
 * the one place a user can compare what the pipeline was configured to do with
 * what it actually produced.
 */
export function FileRowDetails({ node, ingestion, token }: FileRowDetailsProps) {
  const router = useRouter();
  const ready = ingestion.status === "ready";
  const [sortField, setSortField] = useState<ChunkSortField>("chunk_number");
  const [sortDirection, setSortDirection] = useState<ChunkSortDirection>("asc");
  const chunksQuery = useApiQuery(
    () => fetchDocumentChunks(token, ingestion.document_id),
    [token, ingestion.document_id, ingestion.updated_at],
    { enabled: ready },
  );

  const sortedChunks = useMemo(
    () => sortChunks(chunksQuery.data?.chunks ?? [], sortField, sortDirection),
    [chunksQuery.data?.chunks, sortDirection, sortField],
  );

  return (
    <div className="border-t border-hairline bg-surface">
      {ingestion.status === "failed" && (
        <p className="border-b border-hairline px-3 py-2 text-ui text-data-neg">
          {ingestion.error_message ?? "Ingestion failed."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-3 py-2">
        <Readout label="Chunks">{ingestion.num_chunks.toLocaleString()}</Readout>
        <Readout label="Tokens">{ingestion.num_tokens.toLocaleString()}</Readout>
        <Readout label="Strategy">{ingestion.chunk_strategy}</Readout>
        <Readout label="Chunk size">{ingestion.chunk_size.toLocaleString()}</Readout>
        <Readout label="Overlap">{ingestion.chunk_overlap.toLocaleString()}</Readout>
        {ingestion.embedding_model ? (
          <Tooltip content={ingestion.embedding_model}>
            <Readout label="Embedder">{ingestion.embedding_model}</Readout>
          </Tooltip>
        ) : (
          <Readout label="Embedder">
            <span className="text-muted">—</span>
          </Readout>
        )}
        {ingestion.ingestion_run_id && (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => router.push(`/traces/documents/${ingestion.document_id}`)}
          >
            View ingestion trace
          </Button>
        )}
      </div>

      {ready &&
        (chunksQuery.loading ? (
          <ChunkSkeleton />
        ) : chunksQuery.error ? (
          <p className="px-3 py-2 text-ui text-data-neg">{chunksQuery.error}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
              <InstrumentLabel>{`${node.name} chunks`}</InstrumentLabel>
              <SortControl
                label="Sort chunks"
                value={sortField}
                direction={sortDirection}
                options={[
                  { value: "chunk_number", label: "Chunk number" },
                  { value: "ingestion_time", label: "Ingestion time" },
                  { value: "tokens", label: "Tokens" },
                ]}
                onValueChange={(value) => {
                  if (isSortField(value)) {
                    setSortField(value);
                  }
                }}
                onDirectionChange={setSortDirection}
              />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {sortedChunks.map((chunk) => (
                <details key={chunk.id} className="group border-b border-hairline last:border-b-0">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 transition-colors duration-80 ease-standard hover:bg-surface-strong [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-stage-chunk"
                    />
                    <InstrumentLabel className="shrink-0 tabular-nums">
                      {`Chunk ${String(chunk.chunk_index).padStart(2, "0")}`}
                    </InstrumentLabel>
                    <span className="min-w-0 flex-1 truncate text-ui text-body">
                      {truncate(chunk.text, 110)}
                    </span>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-140 ease-standard group-open:rotate-90 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </summary>
                  <div className="border-t border-hairline px-3 py-3">
                    <p className="max-w-[66ch] whitespace-pre-wrap text-ui leading-relaxed text-primary">
                      {chunk.text}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-3">
                      <span className="font-mono text-instrument tabular-nums text-meta">
                        {`${chunk.token_count.toLocaleString()} tokens · ${chunk.text.length.toLocaleString()} chars · ${chunk.chunk_strategy}`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          // The trace identifies results by vector id
                          // ({document_id}:{order}), not the chunk row's UUID.
                          router.push(
                            `/traces/documents/${ingestion.document_id}?chunk=${encodeURIComponent(
                              `${ingestion.document_id}:${chunk.chunk_index}`,
                            )}`,
                          )
                        }
                      >
                        Trace this chunk
                      </Button>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </>
        ))}
    </div>
  );
}
