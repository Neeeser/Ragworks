import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VariablesTree } from "@/components/traces/debugger/VariablesTree";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

import type { PipelineNodeIOTrace } from "@/lib/types";

const TIMESTAMP = "2024-01-01T00:00:00.000Z";
const INPUTS_TITLE = "Inputs";
const NO_INPUTS_LABEL = "No primary inputs recorded.";
const HELLO_VALUE = "hello world";
const ARIA_EXPANDED = "aria-expanded";
const MATCH_ITEMS_LABEL = "Match items";
const FOCUSED_RESULT_BUTTON = "Trace this result chunk-9";

function makeIO(overrides: Partial<PipelineNodeIOTrace> = {}): PipelineNodeIOTrace {
  return {
    id: "io-1",
    run_id: "run-1",
    node_run_id: "nr-1",
    node_id: "node-1",
    io_type: "input",
    port: "documents",
    payload: { value: "raw-payload-value" },
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

describe("VariablesTree", () => {
  it("shows summary values expanded by default and collapses on toggle", () => {
    render(
      <VariablesTree
        title={INPUTS_TITLE}
        tone="cyan"
        summaryItems={[{ label: "Query", value: HELLO_VALUE, kind: "text" }]}
        ioRecords={[]}
        emptySummaryLabel={NO_INPUTS_LABEL}
      />,
    );

    expect(screen.getByText(HELLO_VALUE)).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Query/ });
    expect(toggle).toHaveAttribute(ARIA_EXPANDED, "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute(ARIA_EXPANDED, "false");
    expect(screen.queryByText(HELLO_VALUE)).not.toBeInTheDocument();
  });

  it("keeps raw payloads collapsed until their port row is expanded", () => {
    render(
      <VariablesTree
        title={INPUTS_TITLE}
        tone="cyan"
        summaryItems={[]}
        ioRecords={[makeIO()]}
        emptySummaryLabel={NO_INPUTS_LABEL}
      />,
    );

    expect(screen.queryByText(/raw-payload-value/)).not.toBeInTheDocument();

    const row = screen.getByRole("button", { name: /documents/ });
    expect(row).toHaveAttribute(ARIA_EXPANDED, "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute(ARIA_EXPANDED, "true");
    expect(screen.getByText(/raw-payload-value/)).toBeInTheDocument();
  });

  it("shows the empty labels when nothing was recorded", () => {
    render(
      <VariablesTree
        title="Outputs"
        tone="violet"
        summaryItems={[]}
        ioRecords={[]}
        emptySummaryLabel="No primary outputs recorded."
      />,
    );

    expect(screen.getByText("No primary outputs recorded.")).toBeInTheDocument();
  });

  it("highlights entries containing the traced chunk", () => {
    render(
      <VariablesTree
        title={INPUTS_TITLE}
        tone="cyan"
        summaryItems={[{ label: "Chunk", value: { chunk_id: "chunk-1" }, kind: "json" }]}
        ioRecords={[]}
        focusedItemId="chunk-1"
        emptySummaryLabel={NO_INPUTS_LABEL}
      />,
    );

    expect(screen.getByTestId("variable-row-Chunk")).toHaveAttribute("data-highlighted", "true");
  });

  it("keeps identity-only summaries out of the unfocused run view", () => {
    const summaryItems = [
      { label: "Matches", value: "preview", kind: "text" as const },
      {
        label: MATCH_ITEMS_LABEL,
        value: { kind: "matches", items: [{ id: "chunk-1", score: 0.8 }] },
        kind: "items" as const,
      },
    ];
    const { rerender } = render(
      <VariablesTree
        title={INPUTS_TITLE}
        tone="cyan"
        summaryItems={summaryItems}
        ioRecords={[]}
        emptySummaryLabel={NO_INPUTS_LABEL}
      />,
    );

    expect(screen.getByText("preview")).toBeInTheDocument();
    expect(screen.queryByText(MATCH_ITEMS_LABEL)).not.toBeInTheDocument();

    rerender(
      <VariablesTree
        title={INPUTS_TITLE}
        tone="cyan"
        summaryItems={summaryItems}
        ioRecords={[]}
        focusedItemId="chunk-1"
        emptySummaryLabel={NO_INPUTS_LABEL}
      />,
    );
    expect(screen.getByText(MATCH_ITEMS_LABEL)).toBeInTheDocument();
  });

  it("keeps a focused match in the complete list at its real rank", () => {
    const topMatches = Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      chunk_id: `chunk-${index + 1}`,
      document_id: "doc-1",
      score: 1 - index / 10,
      preview: `Preview ${index + 1}`,
    }));
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `chunk-${index + 1}`,
      score: 1 - index / 10,
    }));

    render(
      <VariablesTree
        title="Outputs"
        tone="violet"
        summaryItems={[
          { label: "Matches", value: { count: 10, top_matches: topMatches }, kind: "json" },
          {
            label: MATCH_ITEMS_LABEL,
            value: { kind: "matches", items },
            kind: "items",
          },
        ]}
        ioRecords={[]}
        focusedItemId="chunk-9"
        onFocusItem={() => undefined}
        emptySummaryLabel="No outputs recorded."
      />,
    );

    const preview = within(screen.getByTestId("variable-row-Matches"));
    expect(preview.queryByRole("button", { name: FOCUSED_RESULT_BUTTON })).toBeNull();
    const complete = within(screen.getByTestId(`variable-row-${MATCH_ITEMS_LABEL}`));
    const rows = complete.getAllByRole("button", { name: /Trace this result/ });
    expect(rows[0]).toHaveAccessibleName("Trace this result chunk-1");
    expect(rows[8]).toHaveAttribute("data-focused", "true");
    expect(complete.getByText("#9")).toBeInTheDocument();
    expect(complete.getByText("0.200")).toBeInTheDocument();
  });

  it.each([
    {
      label: "Reranked order",
      previewValue: Array.from({ length: 8 }, (_, index) => ({
        rank: index + 1,
        chunk_id: `chunk-${index + 1}`,
        score: 1 - index / 10,
      })),
      itemKind: "matches" as const,
    },
    {
      label: "Chunks",
      previewValue: {
        count: 10,
        samples: Array.from({ length: 3 }, (_, index) => ({
          chunk_id: `chunk-${index + 1}`,
          order: index,
          preview: `Chunk ${index + 1}`,
        })),
      },
      itemKind: "chunks" as const,
    },
    {
      label: "Embeddings",
      previewValue: {
        count: 10,
        dimension: 2,
        samples: Array.from({ length: 2 }, (_, index) => ({
          chunk_id: `chunk-${index + 1}`,
          preview: { preview: [0.1, 0.2], total_values: 2 },
        })),
      },
      itemKind: "chunks" as const,
    },
  ])(
    "does not pull a focused item above the $label preview",
    ({ label, previewValue, itemKind }) => {
      render(
        <VariablesTree
          title="Outputs"
          tone="violet"
          summaryItems={[
            { label, value: previewValue, kind: "json" },
            {
              label: "Full items",
              value: {
                kind: itemKind,
                items: Array.from({ length: 10 }, (_, index) => ({
                  id: `chunk-${index + 1}`,
                  score: itemKind === "matches" ? 1 - index / 10 : undefined,
                })),
              },
              kind: "items",
            },
          ]}
          ioRecords={[]}
          focusedItemId="chunk-9"
          onFocusItem={() => undefined}
          emptySummaryLabel="No outputs recorded."
        />,
      );

      const preview = within(screen.getByTestId(`variable-row-${label}`));
      expect(preview.queryByRole("button", { name: FOCUSED_RESULT_BUTTON })).toBeNull();
      const complete = within(screen.getByTestId("variable-row-Full items"));
      expect(complete.getByRole("button", { name: FOCUSED_RESULT_BUTTON })).toHaveAttribute(
        "data-focused",
        "true",
      );
      expect(complete.getByText("#9")).toBeInTheDocument();
    },
  );
});
