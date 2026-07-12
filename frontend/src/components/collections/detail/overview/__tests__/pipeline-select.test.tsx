import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { layoutDefinition } from "@/components/collections/detail/overview/PipelineMiniMap";
import { PipelineSelect } from "@/components/collections/detail/overview/PipelineSelect";
import { makePipeline } from "@/test/fixtures";

import type { PipelineDefinition } from "@/lib/types";

const hybridDefinition: PipelineDefinition = {
  nodes: [
    { id: "in", type: "ingestion.input", name: "Input", config: {} },
    { id: "chunk", type: "chunker.token", name: "Chunker", config: {} },
    { id: "embed", type: "embedder.openrouter", name: "Embedder", config: {} },
    { id: "dense", type: "indexer.pgvector", name: "Dense index", config: {} },
    { id: "bm25", type: "indexer.pgvector", name: "BM25 index", config: {} },
  ],
  edges: [
    { id: "e1", source: "in", target: "chunk" },
    { id: "e2", source: "chunk", target: "embed" },
    { id: "e3", source: "embed", target: "dense" },
    { id: "e4", source: "chunk", target: "bm25" },
  ],
};

const pipelines = [
  makePipeline({ id: "pipe-a", name: "Hybrid A", is_default: true, definition: hybridDefinition }),
  makePipeline({ id: "pipe-b", name: "Dense B" }),
];

describe("layoutDefinition", () => {
  it("layers nodes left-to-right by their longest path from a source", () => {
    const layout = layoutDefinition(hybridDefinition);
    const xOf = new Map(layout.nodes.map((node) => [node.id, node.x]));
    expect(xOf.get("in")!).toBeLessThan(xOf.get("chunk")!);
    expect(xOf.get("chunk")!).toBeLessThan(xOf.get("embed")!);
    expect(xOf.get("embed")!).toBeLessThan(xOf.get("dense")!);
    // The BM25 branch fans out from the chunker into its own later column.
    expect(xOf.get("bm25")!).toBeGreaterThan(xOf.get("chunk")!);
    expect(layout.edges).toHaveLength(4);
  });
});

describe("PipelineSelect", () => {
  it("opens a listbox and previews the hovered option's graph", () => {
    render(
      <PipelineSelect
        label="Ingestion pipeline"
        pipelines={pipelines}
        value="pipe-b"
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ingestion pipeline" }));
    // With no hover yet, the selected pipeline is previewed.
    expect(screen.getByRole("img", { name: "Pipeline preview" })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("option", { name: /Hybrid A/ }));
    expect(screen.getByText("5 nodes · v1")).toBeInTheDocument();
  });

  it("selecting an option reports it and closes the list", () => {
    const onChange = vi.fn();
    render(
      <PipelineSelect
        label="Ingestion pipeline"
        pipelines={pipelines}
        value="pipe-b"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ingestion pipeline" }));
    fireEvent.click(screen.getByRole("option", { name: /Hybrid A/ }));

    expect(onChange).toHaveBeenCalledWith("pipe-a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Escape closes the list without choosing", () => {
    const onChange = vi.fn();
    render(
      <PipelineSelect
        label="Retrieval pipeline"
        pipelines={pipelines}
        value="pipe-b"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retrieval pipeline" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
