"use client";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SeriesLegendTable } from "@/components/collections/detail/overview/SeriesLegendTable";
import { makeLatencySummary } from "@/test/fixtures";

import type { LegendRow } from "@/components/collections/detail/overview/SeriesLegendTable";

const ROWS: LegendRow[] = [
  {
    key: "tool-1",
    name: "Hybrid Search",
    color: "series-1",
    summary: makeLatencySummary({
      count: 51,
      avg_ms: 618,
      p50_ms: 610,
      p95_ms: 1019,
      max_ms: 1073,
    }),
  },
];

function renderTable(expanded: boolean) {
  return render(
    <SeriesLegendTable
      rows={ROWS}
      visible={new Set(ROWS.map((row) => row.key))}
      onToggle={vi.fn()}
      expanded={expanded}
    />,
  );
}

describe("SeriesLegendTable", () => {
  it("heads the collapsed row's lone number with the stat it actually shows", () => {
    // The header is visually hidden but still announced, so a mismatch reads
    // the average out as "Queries" to anyone using a screen reader.
    renderTable(false);

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Tool", "avg"]);

    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveTextContent("618 ms");
  });

  it("carries every percentile column when expanded", () => {
    renderTable(true);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Tool",
      "Queries",
      "avg",
      "p50",
      "p95",
      "p99",
      "max",
    ]);
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("cell")).toHaveLength(6);
  });
});
