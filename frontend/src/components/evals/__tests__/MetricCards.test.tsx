import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCards } from "@/components/evals/MetricCards";

import type { EvalMetricInfo } from "@/lib/types";

const CATALOG: EvalMetricInfo[] = [
  {
    name: "recall",
    label: "Recall@k",
    description: "Of all relevant documents, the fraction retrieved in the top-k.",
    is_rank_aware: false,
  },
];

describe("MetricCards", () => {
  it("renders grouped values with the catalog tooltip on the metric", () => {
    render(<MetricCards aggregates={{ "recall@1": 0.25, "recall@10": 0.8 }} catalog={CATALOG} />);
    expect(screen.getByText("Recall@k")).toBeInTheDocument();
    expect(screen.getByText("0.25")).toBeInTheDocument();
    expect(screen.getByText("0.80")).toBeInTheDocument();
    // The tooltip trigger carries an accessible name tied to the metric.
    expect(screen.getByRole("img", { name: "What Recall@k measures" })).toBeInTheDocument();
  });

  it("explains that metrics are pending when there are none", () => {
    render(<MetricCards aggregates={{}} catalog={CATALOG} />);
    expect(screen.getByText("Metrics land as queries complete.")).toBeInTheDocument();
  });
});
