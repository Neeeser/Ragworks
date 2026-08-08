import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WizardReviewStep } from "@/components/pipelines/WizardReviewStep";

import type { ComponentProps } from "react";

vi.mock("@/components/pipelines/flow/FlowPlayer", () => ({
  FlowPlayer: () => <div data-testid="flow-player" />,
}));

type ReviewProps = ComponentProps<typeof WizardReviewStep>;

function makeProps(overrides: Partial<ReviewProps> = {}): ReviewProps {
  return {
    kind: "ingestion",
    typeLabel: "Ingestion",
    name: "",
    backend: "pgvector",
    indexName: "",
    showStore: true,
    indexIsNew: false,
    bm25IndexName: "",
    showEmbedding: true,
    selectedModelName: null,
    showReranking: false,
    rerankingModelName: null,
    intakeLabel: null,
    showChunking: false,
    chunkPresetLabel: null,
    chunkSize: 512,
    chunkOverlap: 64,
    preview: { nodes: [], edges: [], steps: [] },
    blockers: [],
    ...overrides,
  };
}

describe("WizardReviewStep", () => {
  it("shows summary defaults when details are missing", () => {
    render(<WizardReviewStep {...makeProps()} />);

    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText(/no index/)).toBeInTheDocument();
    expect(screen.getByText("Workspace default")).toBeInTheDocument();
  });

  it("lists a refusal's findings under the node each one names", () => {
    // The graph directly below names these nodes, so a finding rendered as one
    // unattributed string leaves the user with nothing to open.
    render(
      <WizardReviewStep
        {...makeProps({
          blockers: [
            {
              nodeId: "rerank-results",
              label: "Reranker",
              errors: [],
              issues: [
                {
                  message: "Node 'rerank-results' missing inbound edges for: items.",
                  severity: "error",
                  code: "graph.required_input",
                  node_id: "rerank-results",
                },
              ],
            },
            {
              nodeId: null,
              label: "Pipeline",
              errors: ["Pipeline contains at least one cycle."],
              issues: [],
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Reranker")).toBeInTheDocument();
    expect(
      screen.getByText("Node 'rerank-results' missing inbound edges for: items."),
    ).toBeInTheDocument();
    expect(screen.getByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Pipeline contains at least one cycle.")).toBeInTheDocument();
  });

  it("renders no findings section when the definition was not refused", () => {
    render(<WizardReviewStep {...makeProps()} />);

    expect(screen.queryByText(/Fix these before creating/)).not.toBeInTheDocument();
  });
});
