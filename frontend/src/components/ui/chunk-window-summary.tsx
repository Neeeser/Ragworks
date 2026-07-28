"use client";

import { describeChunkWindow } from "@/lib/chunk-defaults";
import { cn } from "@/lib/utils";

type ChunkWindowSummaryProps = {
  chunkSize: number;
  chunkOverlap: number;
  /** What the numbers count. Word-based chunkers say "words". */
  unit?: "tokens" | "words";
  /** The embedding model's usable window, when one is known. */
  limit?: { value: number; modelName: string; published: number } | null;
  /** True when a value is an expression, so the window is a run-time fact. */
  expression?: boolean;
  className?: string;
};

/**
 * States what a chunk size and overlap actually send to the embedder.
 *
 * Chunk size is the new document text per chunk and overlap is added on top,
 * so the emitted chunk is their sum — the number that has to fit the model's
 * input limit. Showing the sum next to the fields is what makes that limit
 * checkable while editing, rather than a surprise at ingest time.
 */
export function ChunkWindowSummary({
  chunkSize,
  chunkOverlap,
  unit = "tokens",
  limit,
  expression,
  className,
}: ChunkWindowSummaryProps) {
  const { perChunk, newText, repeated, invalid } = describeChunkWindow(chunkSize, chunkOverlap);

  if (expression) {
    // Stating a window computed from placeholder zeros would be a false fact
    // about what the run produces.
    return (
      <p className={cn("text-instrument text-muted", className)}>
        An expression sets the window, so its size is decided per run.
      </p>
    );
  }

  if (invalid) {
    return (
      <p className={cn("text-instrument text-data-warn", className)}>
        Chunk size must be greater than zero.
      </p>
    );
  }

  const over = limit != null && perChunk > limit.value;
  const num = (value: number) => (
    <span className="font-mono tabular-nums text-primary">{value.toLocaleString()}</span>
  );

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-instrument text-muted">
        Each chunk is {num(newText)} {unit} of new text
        {repeated > 0 ? (
          <>
            {" "}
            plus {num(repeated)} of overlap ={" "}
            <span className={cn("font-mono tabular-nums", over ? "text-data-neg" : "text-primary")}>
              {perChunk.toLocaleString()}
            </span>{" "}
            {unit} sent to the embedder
          </>
        ) : (
          <> sent to the embedder</>
        )}
        .
        {limit && !over ? (
          <>
            {" "}
            <span className="font-mono text-primary">{limit.modelName}</span> accepts{" "}
            {num(limit.value)} ({limit.published.toLocaleString()} less{" "}
            {(limit.published - limit.value).toLocaleString()} reserved).
          </>
        ) : null}
      </p>
      {over && limit ? (
        // The consequence, not just the arithmetic: oversized chunks are split
        // before indexing, so the boundaries stop being the ones configured.
        <p className="rounded-control border border-data-neg/40 bg-data-neg/10 px-2 py-1.5 text-instrument text-data-neg">
          Over the limit by {(perChunk - limit.value).toLocaleString()} {unit}.{" "}
          <span className="font-mono">{limit.modelName}</span> accepts{" "}
          {limit.value.toLocaleString()} ({limit.published.toLocaleString()} less{" "}
          {(limit.published - limit.value).toLocaleString()} reserved), so chunks this size are
          split before indexing.
        </p>
      ) : null}
    </div>
  );
}
