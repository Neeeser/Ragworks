import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";

type DashboardSummaryProps = {
  collectionCount: number;
  docCount: number;
  chunkCount: number;
  sessionCount: number;
  loading?: boolean;
};

/**
 * The workspace aggregates, in one strip.
 *
 * This is the only place in the console these four numbers appear together:
 * /collections counts one collection per row and /chat counts none of it, so
 * summing them is the overview's job rather than a restatement of another page.
 *
 * Previously three `text-4xl` tiles in a gapped card grid, one of which rendered
 * a blank line (`detail ?? " "`) to keep the tiles even height.
 */
export function DashboardSummary({
  collectionCount,
  docCount,
  chunkCount,
  sessionCount,
  loading = false,
}: DashboardSummaryProps) {
  return (
    <KpiStrip>
      {/* Only the two counts with a single destination are links; "documents"
          and "chunks" span every collection, so there is nowhere for them to go
          that /collections doesn't already say. */}
      <KpiCell label="Collections" value={collectionCount} href="/collections" loading={loading} />
      <KpiCell label="Documents" value={docCount} loading={loading} />
      <KpiCell label="Chunks indexed" value={chunkCount} loading={loading} />
      <KpiCell label="Chat sessions" value={sessionCount} href="/chat" loading={loading} />
    </KpiStrip>
  );
}
