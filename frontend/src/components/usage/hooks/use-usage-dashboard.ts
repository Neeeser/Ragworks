"use client";

import { useMemo, useState } from "react";

import { fetchUsageSummary } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import { DEFAULT_RANGE, buildBuckets, isCustomRangeValid, resolveRange } from "../lib/range";
import { availableMeasures, measureId, resolveMeasure } from "../lib/series";

import type { UsageRangeState } from "../lib/range";
import type { UsageScope } from "@/lib/api";
import type { UsageGroupBy, UsageGroupRow } from "@/lib/types";

/**
 * The dashboard's controls and the reads they drive.
 *
 * Each query is keyed on the string the endpoint actually reads — range,
 * grouping, bucket, user filter — rather than on any id, so changing a control
 * refetches and nothing else does.
 */
export function useUsageDashboard(scope: UsageScope) {
  const { token } = useAuth();
  const [range, setRange] = useState<UsageRangeState>(DEFAULT_RANGE);
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("model");
  const [measureChoice, setMeasureChoice] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Resolved once per render from the control state; a stored copy would go
  // stale against a preset whose "now" moves.
  const resolved = useMemo(() => resolveRange(range), [range]);
  const buckets = useMemo(() => buildBuckets(resolved), [resolved]);
  const scopedUser = scope === "admin" ? userId : null;
  const key = `${resolved.start}|${resolved.end}|${resolved.bucket}|${scopedUser ?? ""}`;
  const ready = Boolean(token) && isCustomRangeValid(range);

  const summary = useApiQuery(
    () =>
      fetchUsageSummary(token ?? "", scope, {
        start: resolved.start,
        end: resolved.end,
        group_by: groupBy,
        bucket: resolved.bucket,
        user_id: scopedUser,
      }),
    [token, scope, key, groupBy],
    { enabled: ready },
  );

  // The breakdown dimensions are fetched only when the selected grouping is not
  // already one of them — the main summary carries those rows verbatim.
  const byModel = useBreakdown(scope, key, "model", groupBy, ready, resolved, scopedUser);
  const bySurface = useBreakdown(scope, key, "surface", groupBy, ready, resolved, scopedUser);

  const measures = availableMeasures(summary.data);
  const measure = resolveMeasure(measureChoice, measures);

  return {
    range,
    setRange,
    groupBy,
    setGroupBy: (next: UsageGroupBy) => {
      setGroupBy(next);
      if (next !== "user") return;
      // Grouping by user covers every account, which a user filter contradicts.
      setUserId(null);
    },
    measures,
    measure,
    selectMeasure: (next: string) => setMeasureChoice(next),
    measureChoice: measure ? measureId(measure) : null,
    userId,
    setUserId,
    resolved,
    buckets,
    summary: summary.data,
    modelGroups: groupBy === "model" ? (summary.data?.groups ?? []) : byModel.groups,
    surfaceGroups: groupBy === "surface" ? (summary.data?.groups ?? []) : bySurface.groups,
    modelError: groupBy === "model" ? null : byModel.error,
    surfaceError: groupBy === "surface" ? null : bySurface.error,
    loading: summary.loading,
    error: summary.error,
    rangeInvalid: !isCustomRangeValid(range),
  };
}

/**
 * One breakdown dimension's group rows, skipped when the page already has them.
 *
 * The error travels with the rows: a panel that only ever sees `[]` renders
 * "no usage in this range" over a request that failed, which reports an
 * outage as a fact about the data.
 */
function useBreakdown(
  scope: UsageScope,
  key: string,
  dimension: UsageGroupBy,
  groupBy: UsageGroupBy,
  ready: boolean,
  resolved: { start: string; end: string; bucket: "day" | "hour" },
  userId: string | null,
): { groups: UsageGroupRow[]; error: string | null } {
  const { token } = useAuth();
  const enabled = ready && groupBy !== dimension;
  const query = useApiQuery(
    () =>
      fetchUsageSummary(token ?? "", scope, {
        start: resolved.start,
        end: resolved.end,
        group_by: dimension,
        bucket: resolved.bucket,
        user_id: userId,
      }),
    [token, scope, key, dimension],
    { enabled },
  );
  return { groups: query.data?.groups ?? [], error: query.error };
}
