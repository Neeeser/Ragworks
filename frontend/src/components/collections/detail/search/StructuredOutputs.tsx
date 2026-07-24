"use client";

/**
 * Renders a structured tool's declared output fields on the search page.
 *
 * Scalar fields (the count tool's `matching_documents`/`matching_chunks`)
 * render as labeled numbers; a facet field's bucket list renders as a small
 * per-value table with document and chunk counts. Any other value falls back
 * to a compact JSON string so a new structured field is never lost.
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

function FacetTable({ buckets }: { buckets: FacetBucket[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.2em] text-meta">
            <th className="pb-1 pr-4 font-normal">Value</th>
            <th className="pb-1 pr-4 font-normal">Documents</th>
            <th className="pb-1 font-normal">Chunks</th>
          </tr>
        </thead>
        <tbody className="font-mono text-primary">
          {buckets.map((bucket, index) => (
            <tr key={`${bucket.value ?? "null"}-${index}`} className="border-t border-hairline">
              <td className="py-1 pr-4">{bucket.value ?? "(no value)"}</td>
              <td className="py-1 pr-4">{bucket.matching_documents}</td>
              <td className="py-1">{bucket.matching_chunks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderValue(value: unknown): ReactNode {
  if (isFacetBuckets(value)) return <FacetTable buckets={value} />;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

export function StructuredOutputs({ outputs }: { outputs: [string, unknown][] }) {
  if (outputs.length === 0) {
    return <p className="mt-5 text-sm text-muted">The tool returned no output fields.</p>;
  }
  return (
    <dl className="mt-5 space-y-2">
      {outputs.map(([name, value]) => (
        <div key={name} className="rounded-2xl border border-hairline bg-surface px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">{name}</dt>
          <dd className="mt-1 font-mono text-sm text-primary">{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
