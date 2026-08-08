"use client";

import { AlertTriangle } from "lucide-react";

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

import type {
  EvalComparisonCaveat,
  EvalConfigDifference,
  EvalMetricInfo,
  EvalRunComparison,
} from "@/lib/types";

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

        {/* One live region for the whole page's state — the fetch failure and the
            comparability banner announce in turn rather than competing. It is a
            real box, not `display: contents`, because a contents element's role
            is dropped by several screen readers along with its box. */}
        {(comparison.error || (data && !data.metrics_comparable)) && (
          <div role="alert" className="flex flex-col gap-3">
            {comparison.error && (
              <p className="max-w-[66ch] text-ui text-data-neg">{comparison.error}</p>
            )}
            {data && !data.metrics_comparable && <ComparabilityBanner caveats={data.caveats} />}
          </div>
        )}

        {!paired && !comparison.error && (
          <Panel className="p-8 text-center">
            <p className="mx-auto max-w-[66ch] text-ui text-muted">Pick two runs to compare.</p>
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

function ComparisonBody({ data, catalog }: { data: EvalRunComparison; catalog: EvalMetricInfo[] }) {
  return (
    <>
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

/**
 * The page labelling itself an invalid comparison.
 *
 * A caveat renders as a banner rather than a paragraph because the deltas below
 * it are still drawn: prose above a table of numbers is skipped, and the whole
 * point of the field is that the numbers must not be read as a comparison. The
 * warn tone is the same one a degraded run wears on its own page.
 */
function ComparabilityBanner({ caveats }: { caveats: EvalComparisonCaveat[] }) {
  return (
    <Panel className="border-data-warn/40 bg-data-warn/8 p-3">
      <p className="flex items-center gap-2 text-ui font-medium text-data-warn">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        Not a valid comparison
      </p>
      <ul className="mt-2 space-y-1.5">
        {caveats.map((caveat) => (
          <li key={`${caveat.code}-${caveat.message}`} className="max-w-[80ch] text-ui text-body">
            {caveat.message}
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-[80ch] text-ui text-muted">
        The numbers below are still each run&apos;s own record of what happened.
      </p>
    </Panel>
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
