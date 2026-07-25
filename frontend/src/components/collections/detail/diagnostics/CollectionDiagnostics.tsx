"use client";

import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { Readout } from "@/components/ui/readout";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimeAgoCompact } from "@/lib/format";

import { DiagnosticItem } from "./DiagnosticItem";
import { useCollectionDiagnostics } from "./use-collection-diagnostics";

import type {
  CollectionDiagnostic,
  CollectionDiagnosticsResponse,
  DiagnosticCategory,
} from "@/lib/types";

const CATEGORY_ORDER: DiagnosticCategory[] = [
  "embedding",
  "backend_storage",
  "index_config",
  "pipeline_compatibility",
  "node_config",
  "run_failures",
  "data_freshness",
];

const CATEGORY_LABEL: Record<DiagnosticCategory, string> = {
  embedding: "Embedding compatibility",
  backend_storage: "Vector-store backend",
  index_config: "Index configuration",
  pipeline_compatibility: "Pipeline compatibility",
  node_config: "Node configuration",
  run_failures: "Recent run failures",
  data_freshness: "Data freshness",
};

interface CollectionDiagnosticsProps {
  collectionId: string;
  token: string;
}

function groupByCategory(
  diagnostics: CollectionDiagnostic[],
): Map<DiagnosticCategory, CollectionDiagnostic[]> {
  const groups = new Map<DiagnosticCategory, CollectionDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const bucket = groups.get(diagnostic.category) ?? [];
    bucket.push(diagnostic);
    groups.set(diagnostic.category, bucket);
  }
  return groups;
}

/**
 * The run's own facts, on one line: the consistency verdict, the counts it is
 * built from, when the checks ran, and the control that runs them again.
 *
 * "Configuration consistent" is deliberately narrower than "nothing is wrong":
 * the backend's `consistent` flag ignores `run_failures` and `node_config`, so a
 * consistent collection can still list warnings below — which is why the counts
 * sit beside the pill rather than behind it.
 */
function DiagnosticsToolbar({
  data,
  loading,
  onRerun,
}: {
  data: CollectionDiagnosticsResponse | null;
  loading: boolean;
  onRerun: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {data ? (
        <>
          <Chip tone={data.consistent ? "pos" : data.error_count > 0 ? "neg" : "warn"} dot>
            {data.consistent ? "Configuration consistent" : "Issues found"}
          </Chip>
          <Readout label="Errors">{data.error_count}</Readout>
          <Readout label="Warnings">{data.warning_count}</Readout>
          <Readout label="Checked">{formatTimeAgoCompact(data.generated_at)}</Readout>
        </>
      ) : null}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onRerun} loading={loading}>
        Re-run
      </Button>
    </div>
  );
}

/** A finding panel at its final geometry, so landing findings reflow nothing. */
function DiagnosticsSkeleton() {
  return (
    <Panel aria-busy>
      <div className="border-b border-hairline px-3 py-2">
        <Skeleton className="h-2 w-44" />
      </div>
      {[0, 1].map((row) => (
        <div key={row} className="border-b border-hairline p-3 last:border-b-0">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-2 w-52" />
          </div>
          <Skeleton className="mt-2 h-2 max-w-[42ch]" />
          <Skeleton className="mt-2.5 h-2 w-64" />
        </div>
      ))}
      <span className="sr-only">Running diagnostics</span>
    </Panel>
  );
}

/** The Diagnostics tab: findings grouped by category, with an empty state. */
export function CollectionDiagnostics({ collectionId, token }: CollectionDiagnosticsProps) {
  const { data, loading, error, reload } = useCollectionDiagnostics(token, collectionId);
  const groups = groupByCategory(data?.diagnostics ?? []);

  return (
    <PageBody className="space-y-3">
      <DiagnosticsToolbar data={data} loading={loading} onRerun={reload} />

      {error ? (
        <Panel className="p-3">
          <p className="max-w-[66ch] text-ui text-data-neg">{error}</p>
        </Panel>
      ) : loading && !data ? (
        <DiagnosticsSkeleton />
      ) : !data || data.diagnostics.length === 0 ? (
        <Panel>
          <div className="p-8 text-center">
            <p className="text-ui text-muted">
              No findings — pipelines and indexed data are consistent.
            </p>
          </div>
        </Panel>
      ) : (
        CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => (
          <Panel key={category}>
            <h2 className="border-b border-hairline px-3 py-2 text-ui font-medium text-primary">
              {CATEGORY_LABEL[category]}
            </h2>
            {groups.get(category)!.map((diagnostic, index) => (
              <DiagnosticItem key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} />
            ))}
          </Panel>
        ))
      )}
    </PageBody>
  );
}
