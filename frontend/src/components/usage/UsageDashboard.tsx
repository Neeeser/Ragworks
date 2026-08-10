"use client";

import { ADMIN_CRUMB, AdminTabs } from "@/components/admin/AdminTabs";
import { PageBody } from "@/components/ui/app-shell";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { PanelGrid } from "@/components/ui/panel";
import { fetchAdminUsers } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import { useUsageDashboard } from "./hooks/use-usage-dashboard";
import { useUsageEvents } from "./hooks/use-usage-events";
import { UsageBreakdownPanel } from "./UsageBreakdownPanel";
import { UsageChartPanel } from "./UsageChartPanel";
import { UsageCustomRange, UsageGroupingBar, UsageRangePicker } from "./UsageControls";
import { UsageEventsPanel } from "./UsageEventsPanel";
import { UsageGroupTable } from "./UsageGroupTable";
import { UsageTotals } from "./UsageTotals";

import type { UsageScope } from "@/lib/api";

/**
 * The usage ledger over a range: what was spent, on what, and the events
 * behind any line of it.
 *
 * One component serves both scopes. The admin scope reads every account's
 * rows, which is what makes the by-user dimension and the account filter
 * meaningful — the per-user routes are already scoped to the caller.
 */
export function UsageDashboard({ scope }: { scope: UsageScope }) {
  const { token } = useAuth();
  const admin = scope === "admin";
  const dashboard = useUsageDashboard(scope);
  const drilldown = useUsageEvents(scope, dashboard.resolved, admin ? dashboard.userId : null);

  const users = useApiQuery(() => fetchAdminUsers(token ?? ""), [token], {
    enabled: admin && Boolean(token),
  });

  const summary = dashboard.summary;

  return (
    <>
      <CrumbBar
        crumbs={admin ? [ADMIN_CRUMB, { label: "Ledger" }] : [{ label: "Usage" }]}
        state={
          <InstrumentLabel>
            {admin ? "Every account's recorded provider spend" : "Your recorded provider spend"}
          </InstrumentLabel>
        }
        actions={<UsageRangePicker range={dashboard.range} onChange={dashboard.setRange} />}
      />
      {admin ? <AdminTabs /> : null}
      <PageBody className="flex flex-col gap-3">
        {dashboard.rangeInvalid ? (
          <p role="alert" className="text-ui text-data-warn">
            Pick a start date on or before the end date.
          </p>
        ) : null}
        {dashboard.error ? (
          <p role="alert" className="text-ui text-data-neg">
            {dashboard.error}
          </p>
        ) : null}

        {dashboard.range.preset === "custom" ? (
          <UsageCustomRange
            range={dashboard.range}
            onChange={dashboard.setRange}
            invalid={dashboard.rangeInvalid}
          />
        ) : null}

        <UsageTotals summary={summary} loading={dashboard.loading && !summary} />

        <UsageChartPanel
          summary={summary}
          buckets={dashboard.buckets}
          bucket={dashboard.resolved.bucket}
          measure={dashboard.measure}
          measures={dashboard.measures}
          onMeasureChange={dashboard.selectMeasure}
          loading={dashboard.loading}
        />

        <PanelGrid columns={2}>
          <UsageBreakdownPanel
            title="By model"
            dimension="model"
            groups={dashboard.modelGroups}
            measure={dashboard.measure}
            error={dashboard.modelError}
            loading={dashboard.loading}
          />
          <UsageBreakdownPanel
            title="By surface"
            dimension="surface"
            groups={dashboard.surfaceGroups}
            measure={dashboard.measure}
            error={dashboard.surfaceError}
            loading={dashboard.loading}
          />
        </PanelGrid>

        <UsageGroupingBar
          admin={admin}
          groupBy={dashboard.groupBy}
          onGroupByChange={dashboard.setGroupBy}
          userId={dashboard.userId}
          users={users.data ?? []}
          usersError={users.error}
          onUserChange={dashboard.setUserId}
        />

        <UsageGroupTable
          groupBy={dashboard.groupBy}
          groups={summary?.groups ?? []}
          selection={drilldown.selection}
          onSelect={drilldown.select}
          loading={dashboard.loading}
        />

        {drilldown.selection ? (
          <UsageEventsPanel
            selection={drilldown.selection}
            events={drilldown.events}
            total={drilldown.total}
            offset={drilldown.offset}
            loading={drilldown.loading}
            error={drilldown.error}
            hasPrevious={drilldown.hasPrevious}
            hasNext={drilldown.hasNext}
            onPrevious={drilldown.previous}
            onNext={drilldown.next}
            onClose={() => drilldown.select(null)}
          />
        ) : null}
      </PageBody>
    </>
  );
}
