"use client";

import { useAdminUsage, USAGE_WINDOWS } from "@/components/admin/hooks/use-admin-usage";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

const tokenFormat = new Intl.NumberFormat("en-US");

function formatCost(cost: number): string {
  return `$${cost.toFixed(cost >= 1 ? 2 : 4)}`;
}

function formatDay(iso: string): string {
  return iso.slice(0, 10);
}

/** "chat.turn_completed" -> "Chat · turn completed" — readable without a
per-event label registry, so unknown/new event types render fine. */
function prettyEventType(eventType: string): string {
  const [domain, ...rest] = eventType.split(".");
  const action = rest.join(".").replaceAll("_", " ");
  const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
  return action ? `${domainLabel} · ${action}` : domainLabel;
}

export function AdminUsagePage() {
  const { windowDays, setWindowDays, summary, points, loading, error } = useAdminUsage();

  const maxTokens = Math.max(1, ...points.map((point) => point.total_tokens));
  const eventCounts = Object.entries(summary?.event_counts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Usage</h1>
          <p className="text-sm text-slate-400">
            Chat activity recorded by local telemetry. Nothing leaves this deployment.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Window">
          {USAGE_WINDOWS.map((days) => (
            <Button
              key={days}
              size="sm"
              variant={windowDays === days ? "primary" : "ghost"}
              aria-pressed={windowDays === days}
              onClick={() => setWindowDays(days)}
            >
              {days}d
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Chat turns", value: summary ? tokenFormat.format(summary.total_turns) : "—" },
          {
            label: "Tokens",
            value: summary ? tokenFormat.format(summary.total_tokens) : "—",
          },
          { label: "Cost", value: summary ? formatCost(summary.total_cost) : "—" },
          {
            label: "Active users",
            value: summary ? tokenFormat.format(summary.active_users) : "—",
          },
        ].map((card) => (
          <GlassCard key={card.label} className="px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{card.value}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="px-5 py-4">
        <h2 className="text-sm font-medium text-white">Tokens per day</h2>
        {points.length === 0 ? (
          <p className="py-6 text-sm text-slate-400">
            {loading ? "Loading…" : "No chat activity in this window yet."}
          </p>
        ) : (
          <div className="mt-4 flex h-32 items-end gap-1" aria-hidden="true">
            {points.map((point) => (
              <div
                key={point.day}
                title={`${formatDay(point.day)}: ${tokenFormat.format(point.total_tokens)} tokens`}
                className={cn("flex-1 rounded-t bg-violet-400/70")}
                style={{ height: `${(point.total_tokens / maxTokens) * 100}%` }}
              />
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="px-5 py-4">
        <h2 className="text-sm font-medium text-white">Activity</h2>
        <p className="text-xs text-slate-400">
          Every recorded event type in this window — new telemetry events appear here automatically.
        </p>
        {eventCounts.length === 0 ? (
          <p className="py-4 text-sm text-slate-400">No activity in this window yet.</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {eventCounts.map(([eventType, count]) => (
              <li
                key={eventType}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm"
              >
                <span className="text-slate-300">{prettyEventType(eventType)}</span>
                <span className="font-semibold text-white">{tokenFormat.format(count)}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard>
        {loading && !summary ? (
          <p className="px-4 py-6 text-sm text-slate-400">Loading usage…</p>
        ) : (
          <DataTable
            rows={summary?.users ?? []}
            rowKey={(row) => row.user_id}
            emptyMessage="No chat activity in this window yet."
            columns={[
              { key: "email", header: "User" },
              {
                key: "turns",
                header: "Turns",
                render: (row) => tokenFormat.format(row.turns),
              },
              {
                key: "total_tokens",
                header: "Tokens",
                render: (row) => tokenFormat.format(row.total_tokens),
              },
              { key: "cost", header: "Cost", render: (row) => formatCost(row.cost) },
              {
                key: "last_active",
                header: "Last active",
                render: (row) => formatDay(row.last_active),
              },
            ]}
          />
        )}
      </GlassCard>
    </div>
  );
}
