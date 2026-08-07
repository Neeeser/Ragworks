import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DatasetsPanel } from "@/components/evals/DatasetsPanel";
import { makeEvalDataset } from "@/test/fixtures";

import type { EvalDataset } from "@/lib/types";

const NOOP = async () => true;
const DESCRIPTION = "Page images from economics reports.";

function renderPanel(datasets: EvalDataset[]) {
  render(
    <DatasetsPanel
      datasets={datasets}
      benchmarks={[]}
      collections={[]}
      chatModels={[]}
      loading={false}
      onImport={NOOP}
      onUpload={NOOP}
      onGenerate={NOOP}
      onDelete={NOOP}
    />,
  );
}

describe("DatasetsPanel", () => {
  it("counts fetched documents while a benchmark import downloads its corpus", () => {
    renderPanel([
      makeEvalDataset({
        name: "ViDoRe economics",
        source: "builtin_benchmark",
        status: "downloading",
        description: DESCRIPTION,
        progress_done: 120,
        progress_total: 452,
      }),
    ]);

    expect(screen.getByText("120 of 452 documents fetched")).toBeInTheDocument();
    // The pulse names the process it depicts, and an import genuinely moves
    // data for minutes.
    expect(
      screen.getByRole("status", { name: "Downloading ViDoRe economics" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(DESCRIPTION)).not.toBeInTheDocument();
  });

  it("counts accepted questions while a synthetic dataset generates", () => {
    renderPanel([
      makeEvalDataset({
        name: "Support set",
        status: "generating",
        progress_done: 8,
        progress_total: 50,
      }),
    ]);

    expect(screen.getByText("8 of 50 questions accepted")).toBeInTheDocument();
  });

  it("renders a ready dataset's description with no progress counters", () => {
    renderPanel([makeEvalDataset({ status: "ready", description: DESCRIPTION })]);

    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
