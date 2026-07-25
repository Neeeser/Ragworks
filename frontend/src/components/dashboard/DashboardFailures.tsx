import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import type { CollectionFailure } from "@/app/(console)/dashboard/use-dashboard-data";

type DashboardFailuresProps = {
  failures: CollectionFailure[];
};

/**
 * Collections holding documents that failed to ingest.
 *
 * The overview already loads every document to count them, so the failures are
 * free to surface here — and nowhere else in the console are they visible
 * without opening each collection in turn. Renders nothing when the count is
 * zero: a permanent "0 failed" line claims a problem the workspace doesn't have
 * and trains the user to ignore the one that matters.
 *
 * Deliberately a notice line rather than a `DataRow` list. A row puts its
 * metadata in right-aligned columns, which on a full-bleed page stranded the
 * count ~1,400px from the collection it belonged to; a count only means
 * something next to the noun it counts.
 */
export function DashboardFailures({ failures }: DashboardFailuresProps) {
  if (failures.length === 0) return null;

  return (
    // A named region: this page carries three peer regions, and a landmark each
    // is how a screen reader user moves between them without reading every row.
    // Raw `card-surface` rather than `Panel` because the landmark needs a
    // <section>, which the div-rendering primitive can't be.
    <section aria-label="Failed ingestion" className="card-surface">
      {failures.map((entry) => (
        <Link
          key={entry.collectionId}
          href={`/collections/${entry.collectionId}/files`}
          className="flex items-center gap-2 rounded-control border-b border-hairline px-3 py-2 last:border-b-0 transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
        >
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-data-neg" aria-hidden />
          {/* One text flow, so a screen reader reads a sentence rather than
              three orphaned fragments, and the count sits beside the noun it
              counts instead of in a column across the page. */}
          <span className="truncate text-ui text-body">
            <span className="font-mono font-medium tabular-nums text-data-neg">{entry.failed}</span>{" "}
            {entry.failed === 1 ? "document" : "documents"} did not ingest in{" "}
            <span className="font-medium text-primary">{entry.name}</span>
          </span>
        </Link>
      ))}
    </section>
  );
}
