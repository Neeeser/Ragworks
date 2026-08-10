/** Builders for usage-ledger objects. */

import type {
  UsageEventPage,
  UsageEventRead,
  UsageGroupRow,
  UsageSeriesPoint,
  UsageSummaryRead,
  UsageUnitTotal,
} from "@/lib/types";

export const USAGE_START = "2026-08-01T00:00:00";
export const USAGE_END = "2026-08-03T00:00:00";

export function makeUsageGroupRow(overrides: Partial<UsageGroupRow> = {}): UsageGroupRow {
  return {
    key: "openai/gpt-4o-mini",
    label: null,
    unit: "tokens",
    quantity: 12_340,
    cost_usd: 0.0031,
    event_count: 4,
    ...overrides,
  };
}

export function makeUsageSeriesPoint(overrides: Partial<UsageSeriesPoint> = {}): UsageSeriesPoint {
  return {
    bucket_start: USAGE_START,
    kind: "chat",
    unit: "tokens",
    quantity: 1_200,
    cost_usd: 0.002,
    ...overrides,
  };
}

export function makeUsageUnitTotal(overrides: Partial<UsageUnitTotal> = {}): UsageUnitTotal {
  return { unit: "tokens", quantity: 12_340, cost_usd: 0.0031, event_count: 4, ...overrides };
}

export function makeUsageSummary(overrides: Partial<UsageSummaryRead> = {}): UsageSummaryRead {
  return {
    start: USAGE_START,
    end: USAGE_END,
    group_by: "model",
    bucket: "day",
    groups: [makeUsageGroupRow()],
    series: [makeUsageSeriesPoint()],
    totals: [makeUsageUnitTotal()],
    total_cost_usd: 0.0031,
    ...overrides,
  };
}

export function makeUsageEvent(overrides: Partial<UsageEventRead> = {}): UsageEventRead {
  return {
    id: "usage-1",
    created_at: USAGE_START,
    user_id: "user-1",
    connection_id: "conn-1",
    provider: "openai",
    model: "openai/gpt-4o-mini",
    kind: "chat",
    surface: "chat",
    context_type: "chat_session",
    context_id: "session-1",
    quantity: 1_200,
    unit: "tokens",
    prompt_tokens: 900,
    completion_tokens: 300,
    cost_usd: 0.002,
    ...overrides,
  };
}

export function makeUsageEventPage(overrides: Partial<UsageEventPage> = {}): UsageEventPage {
  return { events: [makeUsageEvent()], total: 1, limit: 25, offset: 0, ...overrides };
}
