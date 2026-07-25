"use client";

import { useMemo } from "react";

import { SearchResultRow } from "@/components/collections/detail/search/SearchResultRow";
import { StructuredOutputs } from "@/components/collections/detail/search/StructuredOutputs";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";

import type { SearchRunResult } from "@/components/collections/detail/search/use-collection-search";

type SearchResultsProps = {
  result: SearchRunResult;
  /** Opens the run's trace, focused on one chunk when given. */
  onTrace: (chunkId?: string | null) => void;
};

/**
 * The run's results: one card, one row per match.
 *
 * A structured tool's declared output fields *are* its result (count scalars,
 * facet-bucket tables), so chunk rows don't apply and the match count would be
 * a number about nothing.
 */
export function SearchResults({ result, onTrace }: SearchResultsProps) {
  const chunks = useMemo(() => result.chunks ?? [], [result]);
  const topScore = useMemo(() => Math.max(0, ...chunks.map((chunk) => chunk.score ?? 0)), [chunks]);
  const outputs = useMemo(() => Object.entries(result.outputs ?? {}), [result]);
  const structured = result.kind === "structured";

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-3 py-2">
        <InstrumentLabel>Results</InstrumentLabel>
        {!structured && (
          <span className="font-mono text-ui tabular-nums text-primary">
            {chunks.length}{" "}
            <span className="text-muted">{chunks.length === 1 ? "match" : "matches"}</span>
          </span>
        )}
        {result.query_event_id && (
          <span className="ml-auto">
            <Button variant="secondary" size="sm" onClick={() => onTrace()}>
              Trace query
            </Button>
          </span>
        )}
      </div>

      {!structured && outputs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-3 py-2">
          {outputs.map(([name, value]) => (
            <span
              key={name}
              className="max-w-full truncate rounded-full bg-surface px-2 py-0.5 font-mono text-instrument text-meta"
            >
              {name} = {String(value)}
            </span>
          ))}
        </div>
      ) : null}

      {structured ? (
        <StructuredOutputs outputs={outputs} />
      ) : chunks.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">No matches for this query.</p>
      ) : (
        <ul>
          {chunks.map((chunk, index) => (
            <SearchResultRow
              key={`${chunk.chunk_id ?? chunk.id}-${chunk.chunk_index}-${chunk.score}`}
              chunk={chunk}
              rank={index + 1}
              topScore={topScore}
              onTrace={
                // Without a query event there is no trace to open; the row
                // hides the action rather than rendering a dead button.
                result.query_event_id
                  ? () => onTrace((chunk.chunk_id ?? chunk.id) as string)
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
