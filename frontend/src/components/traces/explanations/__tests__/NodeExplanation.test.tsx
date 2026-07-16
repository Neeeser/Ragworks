import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NodeExplanation } from "@/components/traces/explanations/NodeExplanation";
import { makeNodeRunTrace } from "@/test/fixtures";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { TraceStep } from "@/components/traces/trace-graph";
import type { PipelineNodeSummary, TraceFocusedItem } from "@/lib/types";
import type { Node } from "@xyflow/react";

const FOCUSED_TEXT = "Focused text";

const makeStep = (
  nodeType: string,
  summary: PipelineNodeSummary,
  io: TraceStep["io"] = { inputs: [], outputs: [] },
): TraceStep => ({
  nodeId: "node",
  nodeIds: ["node"],
  run: makeNodeRunTrace({ node_id: "node", node_type: nodeType, summary }),
  io,
  stage: nodeType.startsWith("retriev") || nodeType.startsWith("fusion") ? "retrieval" : "origin",
  stageLabel: "Stage",
});

const makeNode = (
  nodeType: string,
  config: Record<string, unknown> = {},
): Node<PipelineNodeData> => ({
  id: "node",
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: { label: "Node", nodeType, description: "Description", inputs: [], outputs: [], config },
});

const contextItem = (index: number, text: string): TraceFocusedItem => ({
  id: `doc:${index}`,
  status: "resolved",
  text,
  document_id: "doc",
  filename: "guide.md",
  chunk_index: index,
  chunk_count: 5,
});

describe("NodeExplanation", () => {
  it("shows parser source path flowing into normalized text", () => {
    const parsedText = "# Guide\nParsed content with the complete normalized document.";
    const onOpenArtifact = vi.fn();
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Source",
          kind: "json",
          value: { document_id: "doc", path: "/uploads/guide.md", content_type: "text/markdown" },
        },
      ],
      outputs: [
        {
          label: "Text",
          kind: "text",
          value: {
            preview: "# Guide\nParsed content",
            length: parsedText.length,
          },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("parser.document", summary, {
          inputs: [],
          outputs: [
            {
              id: "io-output",
              run_id: "run",
              node_run_id: "node-run",
              node_id: "node",
              io_type: "output",
              port: "document",
              payload: { document: { document_id: "doc", text: parsedText } },
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
            },
          ],
        })}
        node={makeNode("parser.document")}
        focusedItemId={null}
        contextItems={[{ ...contextItem(0, "Chunk context"), filename: "logical-name.md" }]}
        itemEffect={null}
        inputSources={[]}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    expect(screen.getByText("/uploads/guide.md")).toBeInTheDocument();
    expect(screen.getByText("text/markdown")).toBeInTheDocument();
    expect(screen.getByText("# Guide Parsed content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open parsed text" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ text: parsedText, filename: "logical-name.md · Parsed text" }),
    );
  });

  it("renders a focused chunk between its real neighbors", () => {
    const summary: PipelineNodeSummary = {
      inputs: [],
      outputs: [
        {
          label: "Chunk items",
          kind: "items",
          value: {
            kind: "chunks",
            items: [0, 1, 2, 3, 4].map((index) => ({ id: `doc:${index}`, score: null })),
          },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("chunker.token", summary)}
        node={makeNode("chunker.token", { chunk_size: 128, chunk_overlap: 16 })}
        focusedItemId="doc:2"
        contextItems={[
          contextItem(0, "Zero"),
          contextItem(1, "One"),
          contextItem(2, "Two"),
          contextItem(3, "Three"),
          contextItem(4, "Four"),
        ]}
        itemEffect={null}
        inputSources={[]}
      />,
    );

    const neighborhood = screen.getByRole("list", { name: "Chunk neighborhood" });
    expect(
      within(neighborhood)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Zero"),
      expect.stringContaining("One"),
      expect.stringContaining("Two"),
      expect.stringContaining("Three"),
      expect.stringContaining("Four"),
    ]);
    const focusedRow = within(neighborhood)
      .getByRole("button", { name: "Inspect result doc:2" })
      .closest("li");
    expect(focusedRow).toHaveAttribute("aria-current", "true");
  });

  it("keeps retrieval order stable and only changes trace focus explicitly", () => {
    const ids = ["doc:0", "doc:1", "doc:2", "doc:3"];
    const summary: PipelineNodeSummary = {
      inputs: [],
      outputs: [
        {
          label: "Match items",
          kind: "items",
          value: { kind: "matches", items: ids.map((id, index) => ({ id, score: 20 - index })) },
        },
      ],
    };
    const onFocusItem = vi.fn();
    const onOpenArtifact = vi.fn();
    const firstContext = contextItem(1, "Chunk 1");

    render(
      <NodeExplanation
        step={makeStep("retriever.bm25", summary)}
        node={makeNode("retriever.bm25")}
        focusedItemId="doc:2"
        contextItems={[firstContext, contextItem(2, "Chunk 2")]}
        itemEffect={null}
        inputSources={[]}
        onFocusItem={onFocusItem}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    expect(screen.getByText("BM25 score")).toBeInTheDocument();
    const ranking = screen.getByRole("list", { name: "BM25 ranking" });
    expect(
      within(ranking)
        .getAllByRole("button", { name: /Inspect result/ })
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(ids.map((id) => `Inspect result ${id}`));

    fireEvent.click(screen.getByRole("button", { name: "Inspect result doc:1" }));
    expect(onFocusItem).not.toHaveBeenCalled();
    expect(screen.getAllByText("Chunk 1")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open chunk" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(firstContext);
    fireEvent.click(screen.getByRole("button", { name: "Focus trace on guide.md · Chunk 2" }));
    expect(onFocusItem).toHaveBeenCalledWith("doc:1");
  });

  it("expands a fused result into proportional source contributions", () => {
    const summary: PipelineNodeSummary = {
      inputs: [
        {
          label: "Branch 1 items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.7 }] },
        },
        {
          label: "Branch 2 items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 12.4 }] },
        },
      ],
      outputs: [
        {
          label: "Matches",
          value: {
            count: 1,
            top_matches: [
              {
                rank: 1,
                chunk_id: "doc:2",
                document_id: "doc",
                score: 0.032,
                preview: "## Focused **text** for pg_search ranking",
              },
            ],
          },
        },
        {
          label: "Fused items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.032 }] },
        },
        {
          label: "Ranking evidence",
          kind: "ranking",
          value: {
            method: "reciprocal_rank_fusion",
            score_label: "RRF score",
            formula: "1 / (60 + rank)",
            results: [
              {
                id: "doc:2",
                rank: 1,
                score: 0.032,
                sources: [
                  { source_index: 0, rank: 3, score: 0.7, contribution: 0.01587 },
                  { source_index: 1, rank: 7, score: 12.4, contribution: 0.01493 },
                ],
              },
            ],
          },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("fusion.rrf", summary)}
        node={makeNode("fusion.rrf", { k: 60 })}
        focusedItemId="doc:2"
        contextItems={[]}
        itemEffect={null}
        inputSources={["Semantic Retriever", "BM25 Retriever"]}
      />,
    );

    expect(screen.getByRole("button", { name: "Inspect result doc:2" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Focused text for pg_search ranking")).toBeInTheDocument();
    expect(screen.getByText("Vector similarity · 0.7000")).toBeInTheDocument();
    expect(screen.getByText("BM25 score · 12.400")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Semantic Retriever contribution" }),
    ).toHaveAttribute("aria-valuenow", "52");
    expect(
      screen.getByRole("progressbar", { name: "BM25 Retriever contribution" }),
    ).toHaveAttribute("aria-valuenow", "48");
    expect(screen.getByText("Fused ranking")).toBeInTheDocument();
    expect(screen.getByText(/1 \/ \(60 \+ rank\)/)).toBeInTheDocument();
    expect(screen.queryByText("Native score")).not.toBeInTheDocument();
  });

  it("preserves the upstream score method at retrieval output", () => {
    const summary: PipelineNodeSummary = {
      inputs: [],
      outputs: [
        {
          label: "Result items",
          kind: "items",
          value: { kind: "matches", items: [{ id: "doc:2", score: 0.032 }] },
        },
      ],
    };

    render(
      <NodeExplanation
        step={makeStep("retrieval.output", summary)}
        node={makeNode("retrieval.output")}
        focusedItemId="doc:2"
        contextItems={[contextItem(2, FOCUSED_TEXT)]}
        itemEffect={null}
        inputSources={["RRF Fusion"]}
      />,
    );

    expect(screen.getByText("RRF score")).toBeInTheDocument();
  });
});
