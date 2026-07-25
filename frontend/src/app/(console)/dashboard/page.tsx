"use client";

import { useRouter } from "next/navigation";

import { DashboardActivity } from "@/components/dashboard/DashboardActivity";
import { DashboardFailures } from "@/components/dashboard/DashboardFailures";
import { DashboardSummary } from "@/components/dashboard/DashboardSummary";
import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";

import { useDashboardData } from "./use-dashboard-data";

import type { ConnectionHealth } from "./use-dashboard-data";

/**
 * Whether the provider connections under this workspace can serve models.
 *
 * This is the breadcrumb's live state because it is the one workspace-level fact
 * no other page shows and every other page depends on: with no valid connection,
 * nothing embeds, retrieves, or answers. It reports the stored config's
 * validity, which is what the API reports — never that the provider is reachable.
 */
function ConnectionState({ health }: { health: ConnectionHealth }) {
  if (health.total === 0) {
    return (
      <Tooltip
        content="No provider connections are configured, so no model can be resolved."
        side="bottom"
      >
        <StatusDot tone="warn" label="No connections" />
      </Tooltip>
    );
  }
  if (health.invalid > 0) {
    return (
      <Tooltip
        content={`${health.invalid} of ${health.total} stored provider configs no longer validate, so they cannot serve models.`}
        side="bottom"
      >
        <StatusDot tone="neg" label={`${health.invalid} of ${health.total} invalid`} />
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Every stored provider config validates." side="bottom">
      <StatusDot
        tone="pos"
        label={`${health.total} ${health.total === 1 ? "connection" : "connections"}`}
      />
    </Tooltip>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const {
    loading,
    error,
    collections,
    sessions,
    stats,
    recentDocuments,
    recentSessions,
    failures,
    collectionNameById,
    connectionHealth,
  } = useDashboardData();

  // Nothing has been created yet, so four zeroes and two empty lists would say
  // less than one line and the action that fixes it.
  const emptyWorkspace = !loading && collections.length === 0 && sessions.length === 0;

  return (
    <>
      {/* No greeting and no title block: the breadcrumb is the page's identity,
          and the rest of the row goes to state the user cannot see elsewhere. */}
      <CrumbBar
        crumbs={[{ label: "Overview" }]}
        state={connectionHealth ? <ConnectionState health={connectionHealth} /> : null}
      />

      <PageBody>
        {error ? (
          <p className="border-b border-hairline px-3 py-2 text-ui text-data-neg">{error}</p>
        ) : emptyWorkspace ? (
          <div className="p-8 text-center">
            <p className="text-ui text-muted">No collections yet.</p>
            <Button size="sm" className="mt-3" onClick={() => router.push("/collections")}>
              Create collection
            </Button>
          </div>
        ) : (
          <>
            <DashboardSummary
              collectionCount={collections.length}
              docCount={stats.docCount}
              chunkCount={stats.totalChunks}
              sessionCount={sessions.length}
              loading={loading}
            />
            <DashboardFailures failures={failures} />
            <DashboardActivity
              recentDocuments={recentDocuments}
              recentSessions={recentSessions}
              collectionNameById={collectionNameById}
              loading={loading}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
