import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FunnelPanel } from "@/components/evals/FunnelPanel";

import type { FunnelSummary } from "@/lib/types";

const FUNNEL: FunnelSummary = {
  stages: [
    {
      node_id: "ingestion",
      node_type: "ingestion",
      label: "Indexed coverage",
      gold_retained: 10,
      gold_total: 10,
      retention: 1,
    },
    {
      node_id: "r1",
      node_type: "retriever.vector",
      label: "Dense",
      gold_retained: 7,
      gold_total: 10,
      retention: 0.7,
    },
  ],
  findings: [
    {
      node_id: "r1",
      label: "Dense",
      severity: "critical",
      category: "retrieval",
      message: "Node 'Dense' (r1) retrieved 70% of gold documents.",
    },
  ],
};

describe("FunnelPanel", () => {
  it("renders one retention row per stage with counts", () => {
    render(<FunnelPanel funnel={FUNNEL} />);
    expect(screen.getByText("Indexed coverage")).toBeInTheDocument();
    expect(screen.getByText("Dense")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Dense: 70% of gold documents retained",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("7/10")).toBeInTheDocument();
  });

  it("renders node-addressed findings", () => {
    render(<FunnelPanel funnel={FUNNEL} />);
    expect(
      screen.getByText("Node 'Dense' (r1) retrieved 70% of gold documents."),
    ).toBeInTheDocument();
  });

  it("renders nothing when there are no stages yet", () => {
    const { container } = render(<FunnelPanel funnel={{ stages: [], findings: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
