import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExecutionLedger } from "@/components/traces/debugger/ExecutionLedger";
import { buildExecutionSections } from "@/components/traces/lib/execution";
import { makeNodeRunTrace } from "@/test/fixtures";

import type { TraceGraph, TraceStep } from "@/components/traces/trace-graph";
import type { PipelineNodeSummaryValue } from "@/lib/types";

const step = (
  nodeId: string,
  nodeName: string,
  outputs: PipelineNodeSummaryValue[] = [],
): TraceStep => ({
  nodeId,
  nodeIds: [nodeId],
  run: makeNodeRunTrace({
    node_id: nodeId,
    node_name: nodeName,
    summary: { inputs: [], outputs },
  }),
  io: { inputs: [], outputs: [] },
  stage: "retrieval",
  stageLabel: "Retrieval",
});

describe("ExecutionLedger", () => {
  it("renders every node and selects one without changing trace focus", () => {
    const graph: TraceGraph = {
      nodes: [],
      edges: [],
      steps: [step("input", "Retrieval input"), step("rank", "RRF fusion")],
      combined: false,
    };
    const onSelectNode = vi.fn();

    render(
      <ExecutionLedger
        sections={buildExecutionSections(graph, null)}
        selectedNodeId="input"
        playbackNodeId="rank"
        onSelectNode={onSelectNode}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Execution order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Execution step Retrieval input" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText("RRF fusion")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Execution step RRF fusion" }));
    expect(onSelectNode).toHaveBeenCalledWith("rank");
  });

  it("labels a retrieval position as a rank instead of an ambiguous number", () => {
    const graph: TraceGraph = {
      nodes: [],
      edges: [],
      steps: [
        step("rank", "Semantic retriever", [
          {
            label: "Match items",
            kind: "items",
            value: {
              kind: "matches",
              items: [
                { id: "other", score: 0.8 },
                { id: "focused", score: 0.7 },
              ],
            },
          },
        ]),
      ],
      combined: false,
    };

    render(
      <ExecutionLedger
        sections={buildExecutionSections(graph, "focused")}
        selectedNodeId="rank"
        playbackNodeId={null}
        onSelectNode={vi.fn()}
      />,
    );

    expect(screen.getByText("Rank 2")).toBeInTheDocument();
    expect(screen.queryByText("#2")).not.toBeInTheDocument();
  });

  it("shows a compact explained badge when a retrieval branch misses the traced result", () => {
    const matches = (id: string): PipelineNodeSummaryValue => ({
      label: "Match items",
      kind: "items",
      value: { kind: "matches", items: [{ id, score: 0.8 }] },
    });
    const graph: TraceGraph = {
      nodes: [],
      edges: [],
      steps: [
        step("semantic", "Semantic retriever", [matches("focused")]),
        step("bm25", "BM25 retriever", [matches("other")]),
      ],
      combined: false,
    };

    render(
      <ExecutionLedger
        sections={buildExecutionSections(graph, "focused")}
        selectedNodeId="bm25"
        playbackNodeId={null}
        onSelectNode={vi.fn()}
      />,
    );

    const explanation = "Not in this node's top 1";
    expect(screen.getByRole("img", { name: explanation })).toHaveClass("text-data-neg");
    expect(screen.getByRole("tooltip")).toHaveTextContent(explanation);
  });
});
