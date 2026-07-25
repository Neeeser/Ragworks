import { DataRow, DataRowHeader } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import type { CollectionFailure } from "@/app/(console)/dashboard/use-dashboard-data";

type DashboardFailuresProps = {
  failures: CollectionFailure[];
};

const COL = { failed: "w-20 text-right" };

/**
 * Collections holding documents that failed to ingest.
 *
 * The overview already loads every document to count them, so the failures are
 * free to surface here — and nowhere else in the console are they visible
 * without opening each collection in turn. Renders nothing when the count is
 * zero: a permanent "0 failed" tile claims a problem the workspace doesn't have
 * and trains the user to ignore the row that matters.
 */
export function DashboardFailures({ failures }: DashboardFailuresProps) {
  if (failures.length === 0) return null;

  return (
    // A named region: three peer lists share this page, and a landmark per list
    // is how a screen reader user moves between them without reading each row.
    <section aria-label="Failed ingestion" className="border-b border-hairline bg-canvas-raised">
      <DataRowHeader
        title="Failed ingestion"
        columns={[
          <InstrumentLabel key="failed" className={COL.failed}>
            Documents
          </InstrumentLabel>,
        ]}
      />
      {failures.map((entry) => (
        <DataRow
          key={entry.collectionId}
          href={`/collections/${entry.collectionId}/files`}
          title={entry.name}
          columns={[
            <span key="failed" className={`font-mono tabular-nums text-data-neg ${COL.failed}`}>
              {entry.failed.toLocaleString()}
            </span>,
          ]}
        />
      ))}
    </section>
  );
}
