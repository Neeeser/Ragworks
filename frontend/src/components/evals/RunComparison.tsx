"use client";

import { ComparisonFunnel } from "@/components/evals/ComparisonFunnel";
import { ComparisonMetrics } from "@/components/evals/ComparisonMetrics";
import { ComparisonQueries } from "@/components/evals/ComparisonQueries";
import { ComparisonSides } from "@/components/evals/ComparisonSides";
import { useRunComparison } from "@/components/evals/hooks/use-run-comparison";
import { PageBody } from "@/components/ui/app-shell";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchEvalMetricCatalog } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import type { EvalConfigDifference, EvalMetricInfo, EvalRunComparison } from "@/lib/types";

/**
 * Two eval runs side by side: what moved, and whether the move counts.
 *
 * The caveats lead. A run on another dataset or one holding a degraded node
 * still renders every delta below, because the numbers are the record of what
 * happened — but reading them as a comparison is the mistake this page exists
 * to prevent.
 */
export function RunComparison() {
  const { token } = useAuth();
  const { runs, comparison, runAId, runBId, paired, select } = useRunComparison();
  const metricCatalog = useApiQuery(() => fetchEvalMetricCatalog(token!), [token], {
    enabled: !!token,
  });
  const data = comparison.data;

  return (
    <>
      <CrumbBar crumbs={[{ label: "Evals", href: "/evals" }, { label: "Compare" }]} />
      <PageBody className="flex flex-col gap-3">
        <ComparisonSides
          runs={runs.data ?? []}
          runAId={runAId}
          runBId={runBId}
          sideA={data?.run_a ?? null}
          sideB={data?.run_b ?? null}
          onSelect={select}
        />

        {comparison.error && (
          <p role="alert" className="max-w-[66ch] text-ui text-data-neg">
            {comparison.error}
          </p>
        )}

        {!paired && !comparison.error && (
          <Panel className="p-8 text-center">
            <p className="mx-auto max-w-[66ch] text-ui text-muted">
              Pick two runs to compare. Their metrics, per-query results, and gold retention are
              lined up side by side.
            </p>
          </Panel>
        )}

        {paired && !data && !comparison.error && (
          <>
            <Panel className="h-40" aria-busy>
              <Skeleton className="m-3 h-3 w-40" />
              <span className="sr-only">Loading comparison</span>
            </Panel>
            <Panel className="h-40" />
          </>
        )}

        {data && <ComparisonBody data={data} catalog={metricCatalog.data ?? []} />}
      </PageBody>
    </>
  );
}

function ComparisonBody({
  data,
  catalog,
}: {
  data: EvalRunComparison;
  catalog: EvalMetricInfo[];
}) {
  return (
    <>
      {data.caveats.map((caveat) => (
        <p
          key={`${caveat.code}-${caveat.message}`}
          role="alert"
          className="max-w-[66ch] text-ui text-data-warn"
        >
          {caveat.message}
        </p>
      ))}

      {data.differences.length > 0 && <DifferencesPanel differences={data.differences} />}

      <ComparisonMetrics metrics={data.metrics} catalog={catalog} />
      <ComparisonFunnel stages={data.funnel} />
      <ComparisonQueries
        queries={data.queries}
        metric={data.headline_metric ?? null}
        k={data.headline_k ?? null}
      />
    </>
  );
}

/** What the two runs were configured differently to do. */
function DifferencesPanel({ differences }: { differences: EvalConfigDifference[] }) {
  return (
    <Panel>
      <PanelHeader title="Configuration difference" />
      <table className="w-full text-left">
        <caption className="sr-only">Fields the two runs differ on</caption>
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className="px-3 py-2">
              <InstrumentLabel>Field</InstrumentLabel>
            </th>
            <th scope="col" className="px-3 py-2">
              <InstrumentLabel>Run A</InstrumentLabel>
            </th>
            <th scope="col" className="px-3 py-2">
              <InstrumentLabel>Run B</InstrumentLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {differences.map((difference) => (
            <tr key={difference.label} className="border-b border-hairline last:border-b-0">
              <th scope="row" className="px-3 py-2 text-left text-ui font-medium text-primary">
                {difference.label}
              </th>
              <td
                className={`px-3 py-2 text-ui ${difference.invalidates ? "text-data-warn" : "text-body"}`}
              >
                {difference.value_a}
              </td>
              <td
                className={`px-3 py-2 text-ui ${difference.invalidates ? "text-data-warn" : "text-body"}`}
              >
                {difference.value_b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
