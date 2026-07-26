import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrendChart } from "@/components/ui/trend-chart";
import { groupMarkers } from "@/components/ui/trend-chart/markers";
import { bucketLabel, isIsolated } from "@/components/ui/trend-chart/scales";

import type { ChartMarker } from "@/components/ui/trend-chart";

const HOUR = 3600;
const DAY = 86400;
const CHART_NAME = /Documents over time/;
const DAY_1 = "2024-03-01T00:00:00Z";

const BUCKETS = [DAY_1, "2024-03-02T00:00:00Z", "2024-03-03T00:00:00Z", "2024-03-04T00:00:00Z"];

function renderChart(overrides: Partial<Parameters<typeof TrendChart>[0]> = {}) {
  const onBrush = vi.fn();
  const onResetBrush = vi.fn();
  render(
    <TrendChart
      buckets={BUCKETS}
      bucketSeconds={DAY}
      series={[{ id: "docs", label: "Documents", color: "series-1", values: [1, 2, 3, 4] }]}
      label="Documents over time"
      formatValue={(value) => `${value}`}
      onBrush={onBrush}
      onResetBrush={onResetBrush}
      {...overrides}
    />,
  );
  return { onBrush, onResetBrush };
}

describe("bucket labels", () => {
  it("widens the label format as the bucket widens", () => {
    // A minute bucket needs its minute; a day bucket would only be noise with one.
    expect(bucketLabel("2024-03-01T04:05:00Z", 60)).toMatch(/\d{1,2}:\d{2}/);
    expect(bucketLabel("2024-03-01T04:00:00Z", HOUR)).not.toMatch(/:\d{2}\b/);
    expect(bucketLabel(DAY_1, DAY)).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("isolated samples", () => {
  it("marks a sample with no drawn neighbour", () => {
    // A lone measurement draws no line segment, so without a dot it is invisible.
    expect(isIsolated([null, 5, null], 1)).toBe(true);
    expect(isIsolated([4, 5, null], 1)).toBe(false);
    expect(isIsolated([null, null, null], 1)).toBe(false);
  });
});

describe("marker grouping", () => {
  const marker = (at: string, id: string): ChartMarker => ({ id, at, label: id });

  it("collapses every marker in one bucket into a single tick", () => {
    // Twenty saves in an afternoon must not draw twenty ticks in one pixel.
    const groups = groupMarkers(
      [
        marker("2024-03-02T01:00:00Z", "a"),
        marker("2024-03-02T18:00:00Z", "b"),
        marker("2024-03-04T02:00:00Z", "c"),
      ],
      BUCKETS,
      DAY,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ index: 1 });
    expect(groups[0].markers.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(groups[1]).toMatchObject({ index: 3 });
  });

  it("drops markers outside the domain rather than pinning them to an edge", () => {
    // Pinning would claim a change happened inside a window it did not.
    const groups = groupMarkers(
      [marker("2020-01-01T00:00:00Z", "old"), marker("2030-01-01T00:00:00Z", "future")],
      BUCKETS,
      DAY,
    );
    expect(groups).toEqual([]);
  });
});

describe("TrendChart selection", () => {
  it("commits a keyboard selection as a span ending after the last bucket", async () => {
    const { onBrush } = renderChart();
    const chart = screen.getByRole("group", { name: CHART_NAME });

    for (const key of [
      { key: "ArrowRight" },
      { key: "ArrowRight", shiftKey: true },
      { key: "Enter" },
    ]) {
      await act(async () => {
        fireEvent.keyDown(chart, key);
      });
    }

    // The end is exclusive, so selecting through 03-02 covers all of that day.
    expect(onBrush).toHaveBeenCalledWith({
      start: DAY_1,
      end: "2024-03-03T00:00:00.000Z",
    });
  });

  it("does not commit a selection that never moved off one bucket", async () => {
    const { onBrush } = renderChart();
    const chart = screen.getByRole("group", { name: CHART_NAME });

    await act(async () => {
      fireEvent.keyDown(chart, { key: "ArrowRight" });
    });
    await act(async () => {
      fireEvent.keyDown(chart, { key: "Enter" });
    });

    expect(onBrush).not.toHaveBeenCalled();
  });

  it("clamps the cursor at the domain edges", async () => {
    const { onBrush } = renderChart();
    const chart = screen.getByRole("group", { name: CHART_NAME });

    // Walk past the right edge, then select back one bucket.
    for (const key of [
      { key: "ArrowRight" },
      { key: "ArrowRight" },
      { key: "ArrowRight" },
      { key: "ArrowRight" },
      { key: "ArrowRight" },
      { key: "ArrowLeft", shiftKey: true },
      { key: "Enter" },
    ]) {
      await act(async () => {
        fireEvent.keyDown(chart, key);
      });
    }

    expect(onBrush).toHaveBeenCalledWith({
      start: "2024-03-03T00:00:00Z",
      end: "2024-03-05T00:00:00.000Z",
    });
  });

  it("clears the selection on escape", async () => {
    const { onResetBrush } = renderChart();
    const chart = screen.getByRole("group", { name: CHART_NAME });

    await act(async () => {
      fireEvent.keyDown(chart, { key: "Escape" });
    });

    expect(onResetBrush).toHaveBeenCalled();
  });

  it("is not focusable when the chart cannot be brushed", () => {
    render(
      <TrendChart
        buckets={BUCKETS}
        bucketSeconds={DAY}
        series={[{ id: "docs", label: "Documents", color: "series-1", values: [1, 2, 3, 4] }]}
        label="Static chart"
        formatValue={(value) => `${value}`}
      />,
    );
    expect(screen.queryByRole("group", { name: /Static chart/ })).not.toBeInTheDocument();
  });
});
