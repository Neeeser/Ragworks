import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { layoutDefinition } from "@/components/pipelines/PipelineMiniMap";
import { PipelineSelect } from "@/components/pipelines/PipelineSelect";
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

const INGESTION_LABEL = "Ingestion pipeline";

const pipelines = [
  makePipeline({ id: "pipe-a", name: "Hybrid A", definition: hybridDefinition }),
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
        label={INGESTION_LABEL}
        pipelines={pipelines}
        value="pipe-b"
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: INGESTION_LABEL }));
    // With no hover yet, the selected pipeline is previewed.
    expect(screen.getByRole("img", { name: "Pipeline preview" })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("option", { name: /Hybrid A/ }));
    expect(screen.getByText("5 nodes · v1")).toBeInTheDocument();
  });

  it("selecting an option reports it and closes the list", () => {
    const onChange = vi.fn();
    render(
      <PipelineSelect
        label={INGESTION_LABEL}
        pipelines={pipelines}
        value="pipe-b"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: INGESTION_LABEL }));
    fireEvent.click(screen.getByRole("option", { name: /Hybrid A/ }));

    expect(onChange).toHaveBeenCalledWith("pipe-a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("refuses to select an unavailable option, leaving the list open", () => {
    const onChange = vi.fn();
    render(
      <PipelineSelect
        label={INGESTION_LABEL}
        pipelines={pipelines}
        value=""
        onChange={onChange}
        unavailable={new Map([["pipe-a", "tool name 'search' already used by Dense B"]])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: INGESTION_LABEL }));
    fireEvent.click(screen.getByRole("option", { name: /Hybrid A/ }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: INGESTION_LABEL })).toHaveTextContent(
      "Select a pipeline",
    );
  });

  it("renders the whole unavailable reason, naming the pipeline holding the tool name", () => {
    const reason = "tool name 'search' already used by Dense B";
    render(
      <PipelineSelect
        label={INGESTION_LABEL}
        pipelines={pipelines}
        value=""
        onChange={vi.fn()}
        unavailable={new Map([["pipe-a", reason]])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: INGESTION_LABEL }));

    // The reason is a line of its own under the name. Appended to the name row,
    // the row's truncation cuts the holding pipeline off the end of it — the
    // half of the message that tells the user what to change.
    const line = screen.getByText(reason);
    expect(line.textContent).toBe(reason);
    const option = screen.getByRole("option", { name: /Hybrid A/ });
    expect(option).toContainElement(line);
    expect(option).toHaveAccessibleName(/tool name 'search' already used by Dense B/);
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
