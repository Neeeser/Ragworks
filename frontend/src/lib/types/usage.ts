/** Usage-ledger wire types, hand-mirrored from `app/schemas/usage.py`. */

import type { UUID } from "@/lib/types/common";

/** Mirrors `UsageKind` — what a recorded provider call spent on. */
export type UsageKind =
  | "chat"
  | "embedding"
  | "rerank"
  | "vector_store_read"
  | "vector_store_write";

/** Mirrors `UsageSurface` — which part of the app made the call. */
export type UsageSurface =
  | "chat"
  | "studio"
  | "ingestion"
  | "eval_generation"
  | "eval_run"
  | "connection_test";

/** Mirrors `UsageUnit` — what a quantity counts. Quantities in different
 * units are never summed; only `cost_usd` crosses units. */
export type UsageUnit = "tokens" | "search_units" | "read_units";

/** Mirrors `UsageGroupBy`. `user` is served by the admin rollup only. */
export type UsageGroupBy = "model" | "kind" | "surface" | "connection" | "user";

/** Mirrors `UsageBucket` — the series granularity. */
export type UsageBucket = "day" | "hour";

/** Mirrors `UsageGroupRow` — one group's spend in one unit.
 * `key` is null for events with no value on the grouped dimension (a call
 * made through a connection that has since been deleted); `label` carries a
 * name only where the key is an id. */
export interface UsageGroupRow {
  key: string | null;
  label: string | null;
  unit: UsageUnit;
  quantity: number;
  cost_usd: number | null;
  event_count: number;
}

/** Mirrors `UsageSeriesPoint` — one bucket's spend for one kind and unit. */
export interface UsageSeriesPoint {
  bucket_start: string;
  kind: UsageKind;
  unit: UsageUnit;
  quantity: number;
  cost_usd: number | null;
}

/** Mirrors `UsageUnitTotal` — the range total for one unit. */
export interface UsageUnitTotal {
  unit: UsageUnit;
  quantity: number;
  cost_usd: number | null;
  event_count: number;
}

/** Mirrors `UsageSummaryRead`. Any `cost_usd` — a group's, a point's, or
 * `total_cost_usd` — is null when the aggregate counted an unpriced event,
 * so a dollar figure never covers only part of the quantity beside it. */
export interface UsageSummaryRead {
  start: string;
  end: string;
  group_by: UsageGroupBy;
  bucket: UsageBucket;
  groups: UsageGroupRow[];
  series: UsageSeriesPoint[];
  totals: UsageUnitTotal[];
  total_cost_usd: number | null;
}

/** Mirrors `UsageEventRead` — one ledger row in the drill-down list. */
export interface UsageEventRead {
  id: UUID;
  created_at: string;
  user_id: UUID;
  connection_id: UUID | null;
  provider: string;
  model: string;
  kind: UsageKind;
  surface: UsageSurface;
  context_type: string | null;
  context_id: UUID | null;
  quantity: number;
  unit: UsageUnit;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
}

/** Mirrors `UsageEventPage` — one page of rows plus the range's total count. */
export interface UsageEventPage {
  events: UsageEventRead[];
  total: number;
  limit: number;
  offset: number;
}
