"use client";

import { ADMIN_CRUMB, AdminTabs } from "@/components/admin/AdminTabs";
import { useAdminUsage, USAGE_WINDOWS } from "@/components/admin/hooks/use-admin-usage";
import { PageBody } from "@/components/ui/app-shell";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { KpiCell, KpiStrip } from "@/components/ui/kpi-strip";
import { Panel, PanelGrid } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { TrendChart, utcDayLabel } from "@/components/ui/trend-chart";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";

import type { UsageWindow } from "@/components/admin/hooks/use-admin-usage";
import type { SegmentedOption } from "@/components/ui/segmented-control";
import type { AdminUsagePoint, AdminUserUsage } from "@/lib/types";

/** The window strip's ids are the day counts as strings — segment ids are text. */
const WINDOW_OPTIONS: Array<SegmentedOption<`${UsageWindow}`>> = USAGE_WINDOWS.map((days) => ({
  id: `${days}`,
  label: `${days}d`,
}));

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/** Cost carries more decimals under a dollar, where 2dp rounds to nothing. */
function formatCost(cost: number): string {
  return `$${cost.toFixed(cost >= 1 ? 2 : 4)}`;
}

/** "chat.turn_completed" -> "Chat · turn completed" — readable without a
per-event label registry, so unknown/new event types render fine. */
function prettyEventType(eventType: string): string {
  const [domain, ...rest] = eventType.split(".");
  const action = rest.join(".").replaceAll("_", " ");
  const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
  return action ? `${domainLabel} · ${action}` : domainLabel;
}

/** Wide enough for a thousands-separated count. */
const NUMERIC_COL = "w-20 text-right";

const EVENT_COL = { count: NUMERIC_COL };
const USER_COL = {
  turns: NUMERIC_COL,
  tokens: "w-24 text-right",
  cost: NUMERIC_COL,
  active: "w-16 text-right",
};

/**
 * The window's two per-day measures. Tokens and turns are different scales, so
 * they get a panel each — a shared axis would make their crossings meaningless.
 */
const CHARTS = [
  {
    label: "Tokens per day",
    color: "series-1",
    read: (point: AdminUsagePoint) => point.total_tokens,
  },
  { label: "Chat turns per day", color: "series-2", read: (point) => point.turns },
] as const satisfies ReadonlyArray<{
  label: string;
  color: "series-1" | "series-2";
  read: (point: AdminUsagePoint) => number;
}>;

/** The chart's plot area, at its final 104px height while the data loads. */
const CHART_PLOT = "h-[104px] w-full";

function UsageCharts({ points, loading }: { points: AdminUsagePoint[]; loading: boolean }) {
  if (points.length === 0) {
    return loading ? (
      <PanelGrid columns={2}>
        {CHARTS.map((chart) => (
          <Panel key={chart.label} className="p-3">
            <InstrumentLabel className="mb-2 block">{chart.label}</InstrumentLabel>
            <Skeleton className={CHART_PLOT} />
          </Panel>
        ))}
      </PanelGrid>
    ) : (
      <Panel className="p-8 text-center">
        <p className="text-ui text-muted">No chat activity in this window yet.</p>
      </Panel>
    );
  }

  const buckets = points.map((point) => point.day);
  return (
    <PanelGrid columns={2}>
      {CHARTS.map((chart) => (
        <Panel key={chart.label} className="p-3">
          <InstrumentLabel className="mb-2 block">{chart.label}</InstrumentLabel>
          <TrendChart
            buckets={buckets}
            bucketSeconds={86400}
            formatBucket={utcDayLabel}
            height={104}
            area
            series={[
              {
                id: chart.label,
                label: chart.label,
                color: chart.color,
                values: points.map(chart.read),
              },
            ]}
            formatValue={(value) => NUMBER_FORMAT.format(value)}
          />
        </Panel>
      ))}
    </PanelGrid>
  );
}

/** Every event type recorded in the window — generic, never a per-event registry. */
function TelemetryEventsPanel({
  eventCounts,
  loading,
}: {
  eventCounts: Array<[string, number]>;
  loading: boolean;
}) {
  return (
    <section aria-label="Telemetry events" className="card-surface">
      <DataRowHeader
        title="Telemetry events"
        columns={[
          <InstrumentLabel key="count" className={EVENT_COL.count}>
            Count
          </InstrumentLabel>,
        ]}
      />
      {loading ? (
        <DataRowSkeleton label="Loading telemetry events" columnWidths={[EVENT_COL.count]} />
      ) : eventCounts.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">No events recorded yet.</p>
      ) : (
        eventCounts.map(([eventType, count]) => (
          <DataRow
            key={eventType}
            title={prettyEventType(eventType)}
            columns={[
              <span key="count" className={`font-mono tabular-nums ${EVENT_COL.count}`}>
                {NUMBER_FORMAT.format(count)}
              </span>,
            ]}
          />
        ))
      )}
    </section>
  );
}

/** The same window broken down per account. */
function UsageByUserPanel({ users, loading }: { users: AdminUserUsage[]; loading: boolean }) {
  return (
    <section aria-label="Usage by user" className="card-surface">
      <DataRowHeader
        title="User"
        columns={[
          <InstrumentLabel key="turns" className={USER_COL.turns}>
            Turns
          </InstrumentLabel>,
          <InstrumentLabel key="tokens" className={USER_COL.tokens}>
            Tokens
          </InstrumentLabel>,
          <InstrumentLabel key="cost" className={USER_COL.cost}>
            Cost
          </InstrumentLabel>,
          <InstrumentLabel key="active" className={USER_COL.active}>
            Active
          </InstrumentLabel>,
        ]}
      />
      {loading ? (
        <DataRowSkeleton
          label="Loading usage by user"
          columnWidths={[USER_COL.turns, USER_COL.tokens, USER_COL.cost, USER_COL.active]}
        />
      ) : users.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">No chat activity in this window yet.</p>
      ) : (
        users.map((row) => (
          <DataRow
            key={row.user_id}
            title={row.email}
            columns={[
              <span key="turns" className={`font-mono tabular-nums ${USER_COL.turns}`}>
                {NUMBER_FORMAT.format(row.turns)}
              </span>,
              <span key="tokens" className={`font-mono tabular-nums ${USER_COL.tokens}`}>
                {NUMBER_FORMAT.format(row.total_tokens)}
              </span>,
              <span key="cost" className={`font-mono tabular-nums ${USER_COL.cost}`}>
                {formatCost(row.cost)}
              </span>,
              <Tooltip
                key="active"
                content={parseApiDate(row.last_active).toLocaleString()}
                triggerClassName={`justify-end ${USER_COL.active}`}
              >
                <span className="font-mono tabular-nums text-meta">
                  {formatTimeAgoCompact(row.last_active)}
                </span>
              </Tooltip>,
            ]}
          />
        ))
      )}
    </section>
  );
}

/**
 * The deployment's chat usage over a chosen window: the four current values,
 * the two per-day measures, every recorded telemetry event type, and the
 * per-user breakdown.
 */
export function AdminUsagePage() {
  const { windowDays, setWindowDays, summary, points, loading, error } = useAdminUsage();

  const eventCounts = Object.entries(summary?.event_counts ?? {}).sort((a, b) => b[1] - a[1]);
  const users = summary?.users ?? [];
  const pending = loading && !summary;

  return (
    <>
      <CrumbBar
        crumbs={[ADMIN_CRUMB, { label: "Usage" }]}
        state={<InstrumentLabel>Local telemetry; nothing leaves this deployment</InstrumentLabel>}
        actions={
          <SegmentedControl
            aria-label="Window"
            options={WINDOW_OPTIONS}
            value={`${windowDays}`}
            onChange={(id) => setWindowDays(Number(id) as UsageWindow)}
          />
        }
      />
      <AdminTabs />
      <PageBody className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-ui text-data-neg">
            {error}
          </p>
        )}

        <KpiStrip>
          <KpiCell label="Chat turns" value={summary?.total_turns ?? null} loading={pending} />
          <KpiCell label="Tokens" value={summary?.total_tokens ?? null} loading={pending} />
          <KpiCell
            label="Cost"
            value={summary ? formatCost(summary.total_cost) : null}
            loading={pending}
          />
          <KpiCell label="Active users" value={summary?.active_users ?? null} loading={pending} />
        </KpiStrip>

        <UsageCharts points={points} loading={loading} />

        <PanelGrid columns={2} className="min-h-0 flex-1">
          <TelemetryEventsPanel eventCounts={eventCounts} loading={pending} />
          <UsageByUserPanel users={users} loading={pending} />
        </PanelGrid>
      </PageBody>
    </>
  );
}
