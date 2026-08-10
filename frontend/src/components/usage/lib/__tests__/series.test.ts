import { describe, expect, it } from "vitest";

import {
  availableMeasures,
  buildBars,
  buildKindSeries,
  buildTotalCostSeries,
  hasUnpricedEvents,
  resolveMeasure,
} from "@/components/usage/lib/series";
import {
  makeUsageGroupRow,
  makeUsageSeriesPoint,
  makeUsageSummary,
  makeUsageUnitTotal,
} from "@/test/fixtures";

const AUG_1 = "2026-08-01T00:00:00";
const BUCKETS = ["2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"];
const TOKENS = { kind: "quantity", unit: "tokens" } as const;
const COST = { kind: "cost" } as const;

describe("usage series", () => {
  it("places an offset-less API bucket start on the matching UTC tick", () => {
    // The API serializes without a trailing Z; parsed as local time these land
    // on a tick that is hours away, or off the axis entirely.
    const summary = makeUsageSummary({
      series: [makeUsageSeriesPoint({ bucket_start: "2026-08-02T00:00:00", quantity: 700 })],
    });

    const [series] = buildKindSeries(summary, BUCKETS, TOKENS);

    expect(series.values).toEqual([null, 700]);
  });

  it("leaves a bucket with no points as a gap rather than a zero", () => {
    const summary = makeUsageSummary({
      series: [makeUsageSeriesPoint({ bucket_start: AUG_1, quantity: 500 })],
    });

    const [series] = buildKindSeries(summary, BUCKETS, TOKENS);

    expect(series.values).toEqual([500, null]);
  });

  it("drops a cost bucket that counted an unpriced event instead of understating it", () => {
    const summary = makeUsageSummary({
      series: [
        makeUsageSeriesPoint({ bucket_start: AUG_1, cost_usd: 0.004 }),
        makeUsageSeriesPoint({
          bucket_start: AUG_1,
          unit: "read_units",
          cost_usd: null,
        }),
      ],
    });

    const [series] = buildKindSeries(summary, BUCKETS, COST);

    expect(series.values[0]).toBeNull();
  });

  it("counts only the selected unit, never a sum across units", () => {
    const summary = makeUsageSummary({
      series: [
        makeUsageSeriesPoint({ bucket_start: AUG_1, quantity: 900 }),
        makeUsageSeriesPoint({
          bucket_start: AUG_1,
          unit: "search_units",
          quantity: 5,
        }),
      ],
    });

    const [series] = buildKindSeries(summary, BUCKETS, TOKENS);

    expect(series.values[0]).toBe(900);
  });

  it("gives each kind its own series in a fixed order, so a colour follows the kind", () => {
    const summary = makeUsageSummary({
      series: [makeUsageSeriesPoint({ kind: "embedding" }), makeUsageSeriesPoint({ kind: "chat" })],
    });

    const series = buildKindSeries(summary, BUCKETS, TOKENS);

    expect(series.map((entry) => entry.id)).toEqual(["chat", "embedding"]);
    expect(series[0].color).toBe("series-1");
    expect(series[1].color).toBe("series-2");
  });

  it("offers cost only when something in the range was priced", () => {
    const priced = makeUsageSummary({ totals: [makeUsageUnitTotal({ cost_usd: 0.01 })] });
    const unpriced = makeUsageSummary({ totals: [makeUsageUnitTotal({ cost_usd: null })] });

    expect(availableMeasures(priced).map((measure) => measure.kind)).toContain("cost");
    expect(availableMeasures(unpriced).map((measure) => measure.kind)).not.toContain("cost");
  });

  it("falls back to an available measure when the selected one left the range", () => {
    const available = availableMeasures(
      makeUsageSummary({ totals: [makeUsageUnitTotal({ unit: "read_units", cost_usd: null })] }),
    );

    expect(resolveMeasure("tokens", available)).toEqual({ kind: "quantity", unit: "read_units" });
  });

  it("never folds a group's other-unit row into its bar", () => {
    const bars = buildBars(
      [
        makeUsageGroupRow({ key: "model-a", unit: "tokens", quantity: 1_000 }),
        makeUsageGroupRow({ key: "model-a", unit: "read_units", quantity: 40 }),
      ],
      TOKENS,
      (row) => row.key ?? "",
    );

    expect(bars).toEqual([{ key: "model-a", label: "model-a", value: 1_000 }]);
  });

  it("drops a key's whole cost bar when any one of its unit rows is unpriced", () => {
    // One model billed in tokens (priced) and read units (unpriced): charging
    // the bar at the token cost alone labels a partial total as that model's
    // cost, which is the defect the whole ledger exists to avoid.
    const bars = buildBars(
      [
        makeUsageGroupRow({ key: "model-a", unit: "tokens", cost_usd: 0.5 }),
        makeUsageGroupRow({ key: "model-a", unit: "read_units", cost_usd: null }),
        makeUsageGroupRow({ key: "model-b", unit: "tokens", cost_usd: 0.2 }),
      ],
      COST,
      (row) => row.key ?? "",
    );

    expect(bars).toEqual([{ key: "model-b", label: "model-b", value: 0.2 }]);
  });

  it("returns every category so the caller can say how many it is not showing", () => {
    const groups = Array.from({ length: 9 }, (_, index) =>
      makeUsageGroupRow({ key: `model-${index}`, quantity: index + 1 }),
    );

    expect(buildBars(groups, TOKENS, (row) => row.key ?? "")).toHaveLength(9);
  });

  it("sums the kinds into a total under the cost measure", () => {
    const summary = makeUsageSummary({
      series: [
        makeUsageSeriesPoint({ bucket_start: AUG_1, kind: "chat", cost_usd: 0.03 }),
        makeUsageSeriesPoint({ bucket_start: AUG_1, kind: "embedding", cost_usd: 0.01 }),
      ],
    });

    const total = buildTotalCostSeries(summary, BUCKETS);

    expect(total?.label).toBe("Total");
    expect(total?.values[0]).toBeCloseTo(0.04);
  });

  it("drops a total bucket that counted an unpriced event", () => {
    const summary = makeUsageSummary({
      series: [
        makeUsageSeriesPoint({ bucket_start: AUG_1, cost_usd: 0.03 }),
        makeUsageSeriesPoint({ bucket_start: AUG_1, kind: "rerank", cost_usd: null }),
      ],
    });

    expect(buildTotalCostSeries(summary, BUCKETS)?.values[0]).toBeNull();
    expect(hasUnpricedEvents(summary)).toBe(true);
  });

  it("reports no total for a range with nothing in it", () => {
    expect(buildTotalCostSeries(makeUsageSummary({ series: [] }), BUCKETS)).toBeNull();
  });

  it("leaves an unpriced group out of a cost bar rather than drawing it at zero", () => {
    const bars = buildBars(
      [
        makeUsageGroupRow({ key: "priced", cost_usd: 0.5 }),
        makeUsageGroupRow({ key: "unpriced", cost_usd: null }),
      ],
      COST,
      (row) => row.key ?? "",
    );

    expect(bars.map((bar) => bar.key)).toEqual(["priced"]);
  });
});
