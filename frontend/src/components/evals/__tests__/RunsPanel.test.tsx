import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunsPanel } from "@/components/evals/RunsPanel";
import { makeEvalRunSummary } from "@/test/fixtures";

const NOOP = async () => true;

describe("RunsPanel", () => {
  it("shows dataset coverage percentages with absolute-count tooltips", () => {
    render(
      <RunsPanel
        runs={[makeEvalRunSummary()]}
        datasets={[]}
        metricCatalog={[]}
        loading={false}
        onNewRun={() => undefined}
        onDeleteRun={NOOP}
      />,
    );
    expect(screen.getByText("docs 6%")).toBeInTheDocument();
    expect(screen.getByText("queries 17%")).toBeInTheDocument();
    expect(screen.getByText("302 of 5,183 corpus documents ingested")).toBeInTheDocument();
    expect(screen.getByText("50 of 300 dataset queries evaluated")).toBeInTheDocument();
  });

  it("renders an em-dash when a run has no coverage yet", () => {
    render(
      <RunsPanel
        runs={[makeEvalRunSummary({ coverage: null, status: "pending" })]}
        datasets={[]}
        metricCatalog={[]}
        loading={false}
        onNewRun={() => undefined}
        onDeleteRun={NOOP}
      />,
    );
    expect(screen.queryByText(/docs \d/)).not.toBeInTheDocument();
  });
});
