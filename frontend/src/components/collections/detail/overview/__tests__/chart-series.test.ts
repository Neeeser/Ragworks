import { describe, expect, it } from "vitest";

import { makeStatsHistoryPoint } from "@/test/fixtures";

import { growthDots, growthEvents, latencyBand, latencyDots, radiusFor } from "../lib/chart-series";

import type { CollectionStatsHistoryPoint } from "@/lib/types";

const documents = (point: CollectionStatsHistoryPoint) => point.document_total;

function points(totals: number[]): CollectionStatsHistoryPoint[] {
  return totals.map((total, index) =>
    makeStatsHistoryPoint({
      bucket_start: `2024-01-0${index + 1}T00:00:00Z`,
      document_total: total,
    }),
  );
}

describe("growthEvents", () => {
  it("reports the addition between totals, not the totals themselves", () => {
    const events = growthEvents(points([10, 10, 350]), documents);

    // The first bucket's own total is an addition: the domain opens empty.
    expect(events.map((event) => event.added)).toEqual([10, 340]);
    expect(events.map((event) => event.total)).toEqual([10, 350]);
  });

  it("emits nothing for a bucket where nothing was ingested", () => {
    // A dot on every bucket would bury the ones that mattered.
    expect(growthEvents(points([5, 5, 5]), documents)).toHaveLength(1);
  });

  it("keeps a deletion as a negative addition", () => {
    // Losing 3 documents is a real event; dropping it makes the step
    // unexplained.
    const events = growthEvents(points([9, 6]), documents);

    expect(events[1].added).toBe(-3);
  });
});

describe("radiusFor", () => {
  it("scales by area, so four times the addition is twice the radius span", () => {
    // Linear radius would make a 4x ingestion read as 16x the ink.
    const quarter = radiusFor(25, 100);
    const full = radiusFor(100, 100);
    const min = radiusFor(0, 100);

    expect((quarter - min) / (full - min)).toBeCloseTo(0.5);
  });

  it("keeps the smallest addition visible rather than shrinking it away", () => {
    expect(radiusFor(1, 100_000)).toBeGreaterThan(0);
  });
});

describe("growthDots", () => {
  it("puts each dot at the total its addition produced", () => {
    const buckets = ["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"];
    const dots = growthDots(
      growthEvents(points([10, 350]), documents),
      buckets,
      "series-1",
      (value) => value.toLocaleString(),
      "documents",
    );

    expect(dots.map((dot) => dot.value)).toEqual([10, 350]);
    expect(dots[1].label).toBe("+340 documents · 350 total");
    // The bigger ingestion is the bigger dot — that is the whole signal.
    expect(dots[1].radius).toBeGreaterThan(dots[0].radius as number);
  });
});

describe("latencyBand", () => {
  it("spans p50 to p95 for a bucket that measured a spread", () => {
    const band = latencyBand(
      [makeStatsHistoryPoint({ ingestion: { count: 4, p50_ms: 100, p95_ms: 400 } })],
      (point) => point.ingestion,
      "series-1",
    );

    expect(band.lower).toEqual([100]);
    expect(band.upper).toEqual([400]);
  });

  it("skips a bucket holding one sample, which has no spread to shade", () => {
    // Its p50 and p95 are both that one measurement, and shading between lone
    // values inflates a single slow run into a wedge of invented variance.
    const band = latencyBand(
      [makeStatsHistoryPoint({ ingestion: { count: 1, p50_ms: 900, p95_ms: 900 } })],
      (point) => point.ingestion,
      "series-1",
    );

    expect(band.lower).toEqual([null]);
    expect(band.upper).toEqual([null]);
  });

  it("carries null on both bounds where nothing was measured", () => {
    // A band spanning an unmeasured bucket claims a spread nobody recorded.
    const band = latencyBand(
      [makeStatsHistoryPoint({ ingestion: { count: 0 } })],
      (point) => point.ingestion,
      "series-1",
    );

    expect(band.lower).toEqual([null]);
    expect(band.upper).toEqual([null]);
  });
});

describe("latencyDots", () => {
  const events = [
    { at: "2024-01-01T00:00:00Z", duration_ms: 40, key: "a" },
    { at: "2024-01-01T01:00:00Z", duration_ms: 90, key: "b" },
  ];

  it("lights every series by default", () => {
    const dots = latencyDots(events, () => "series-1", String);

    expect(dots.every((dot) => !dot.muted)).toBe(true);
  });

  it("dims an unlit series without dropping it", () => {
    // A hidden tool's traffic is still context: removing its dots makes a busy
    // stretch look idle.
    const dots = latencyDots(
      events,
      () => "series-1",
      String,
      (key) => key === "a",
    );

    expect(dots.map((dot) => dot.muted)).toEqual([false, true]);
  });
});
