"use client";

/**
 * Renders a structured tool's declared output fields on the search page.
 *
 * Scalar fields (the count tool's `matching_documents`/`matching_chunks`)
 * render as labeled numbers; a facet field's bucket list renders as a small
 * per-value table with document and chunk counts. Any other value falls back
 * to a compact JSON string so a new structured field is never lost.
 *
 * Fields are hairline-separated rows inside the results card rather than a
 * bordered box each: a single value never gets its own container.
 */
import type { ReactNode } from "react";

type FacetBucket = {
  value: string | null;
  matching_documents: number;
  matching_chunks: number;
};

function isFacetBuckets(value: unknown): value is FacetBucket[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (bucket) =>
        bucket !== null &&
        typeof bucket === "object" &&
        "matching_documents" in bucket &&
        "matching_chunks" in bucket,
    )
  );
}

const HEADER_CELL = "pb-1 text-instrument font-medium text-muted";
const COUNT_CELL = "py-1 text-right font-mono text-ui tabular-nums text-primary";

function FacetTable({ buckets }: { buckets: FacetBucket[] }) {
  return (
    // Wide content scrolls inside its own container so the page never scrolls
    // horizontally.
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr>
            <th className={`${HEADER_CELL} pr-4`}>Value</th>
            <th className={`${HEADER_CELL} pr-4 text-right`}>Documents</th>
            <th className={`${HEADER_CELL} text-right`}>Chunks</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket, index) => (
            <tr key={`${bucket.value ?? "null"}-${index}`} className="border-t border-hairline">
              <td className="py-1 pr-4 font-mono text-ui text-primary">
                {bucket.value ?? "(no value)"}
              </td>
              <td className={`${COUNT_CELL} pr-4`}>{bucket.matching_documents.toLocaleString()}</td>
              <td className={COUNT_CELL}>{bucket.matching_chunks.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderValue(value: unknown): ReactNode {
  if (isFacetBuckets(value)) return <FacetTable buckets={value} />;
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

export function StructuredOutputs({ outputs }: { outputs: [string, unknown][] }) {
  if (outputs.length === 0) {
    return (
      <p className="p-8 text-center text-ui text-muted">The tool returned no output fields.</p>
    );
  }
  return (
    <dl>
      {outputs.map(([name, value]) => (
        <div
          key={name}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-3 py-2 last:border-b-0"
        >
          {/* A declared field name is a literal the tool schema defines, so it
              renders verbatim in mono rather than through the label voice. */}
          <dt className="shrink-0 font-mono text-instrument text-muted">{name}</dt>
          <dd className="min-w-0 flex-1 font-mono text-ui tabular-nums text-primary">
            {renderValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
