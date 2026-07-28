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
 * States what a chunk size and overlap actually produce.
 *
 * Two numbers and a model limit leave the reader to infer the relationship,
 * and the intuitive inference is wrong: chunk size reads as "new text per
 * chunk, with overlap added on top", which would send `size + overlap` to the
 * embedder. It sends `size`. Naming all three numbers is cheaper than letting
 * someone size their chunks against a limit that was never the constraint.
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
        Overlap must be smaller than chunk size.
      </p>
    );
  }

  const percent = Math.round((repeated / perChunk) * 100);
  const num = (value: number) => (
    <span className="font-mono tabular-nums text-primary">{value.toLocaleString()}</span>
  );

  return (
    <p className={cn("text-instrument text-muted", className)}>
      Each chunk is {num(perChunk)} {unit}: {num(newText)} of new text
      {repeated > 0 ? (
        <>
          {" "}
          plus {num(repeated)} repeated from the previous chunk ({percent}% of chunk size)
        </>
      ) : null}
      .
      {limit ? (
        <>
          {" "}
          <span className="font-mono text-primary">{limit.modelName}</span> accepts{" "}
          {num(limit.value)} ({limit.published.toLocaleString()} less{" "}
          {(limit.published - limit.value).toLocaleString()} reserved).
        </>
      ) : null}
    </p>
  );
}
