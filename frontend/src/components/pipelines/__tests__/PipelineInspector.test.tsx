import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineInspector } from "@/components/pipelines/PipelineInspector";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { VectorIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";

const NODE_TYPE_EMBEDDER = "embedder.openrouter";
const NODE_TYPE_INDEXER = "indexer.vector";
const NODE_TYPE_PARSER = "parser.document";
const INDEX_SELECT_LABEL = "Vector index";

const parameterInputMock = vi.fn();
let lastEmbeddingProps: Record<string, unknown> | null = null;

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

vi.mock("@/components/ui/parameter-controls", () => ({
  ParameterFieldCard: ({
    label,
    helper,
    children,
  }: {
    label: string;
    helper?: string | null;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      {helper && <span>{helper}</span>}
      {children}
    </div>
  ),
  ParameterInput: (props: { input: string; onChange: (value: string | boolean) => void }) => {
    parameterInputMock(props);
    return (
      <button
        type="button"
        onClick={() => {
          if (props.input === "number") props.onChange("1.2");
          else if (props.input === "integer") props.onChange("3");
          else if (props.input === "boolean") props.onChange(true);
          else props.onChange("text");
        }}
      >
        {`trigger-${props.input}`}
      </button>
    );
  },
}));

vi.mock("@/components/pipelines/EmbeddingModelSelectorCard", () => ({
  EmbeddingModelSelectorCard: (props: Record<string, unknown>) => {
    lastEmbeddingProps = props;
    return <div data-testid="embedding-selector" />;
  },
}));

const makeNode = (
  nodeType: string,
  config: Record<string, unknown> = {},
  configSchema: Record<string, unknown> = {},
): Node<PipelineNodeData> => ({
  id: "node-1",
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: {
    label: "Node",
    nodeType,
    inputs: [],
    outputs: [],
    config,
    configSchema,
  },
});

const indexes: VectorIndex[] = [
  { name: "alpha", backend: "pinecone", dimension: 768 },
  { name: "local", backend: "pgvector", dimension: 384 },
];

describe("PipelineInspector", () => {
  beforeEach(() => {
    parameterInputMock.mockClear();
    lastEmbeddingProps = null;
  });

  it("shows placeholder when no node is selected", () => {
    render(
      <PipelineInspector
        selectedNode={null}
        onConfigChange={() => undefined}
        onLabelChange={() => undefined}
      />,
    );
    expect(screen.getByText(/Select a node/)).toBeInTheDocument();
  });

  it("applies schema field edits immediately, with no Apply button", () => {
    const onConfigChange = vi.fn();
    render(
      <PipelineInspector
        selectedNode={makeNode(
          NODE_TYPE_PARSER,
          { mode: "auto" },
          { properties: { mode: { type: "string" } } },
        )}
        onConfigChange={onConfigChange}
        onLabelChange={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("trigger-text"));
    expect(onConfigChange).toHaveBeenCalledWith({ mode: "text" });
  });

  it("filters the index picker to the node's configured backend and applies the pick", () => {
    const onConfigChange = vi.fn();
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" })}
        onConfigChange={onConfigChange}
        onLabelChange={() => undefined}
        vectorIndexes={indexes}
      />,
    );

    const select = screen.getByLabelText(INDEX_SELECT_LABEL);
    expect(screen.getByRole("option", { name: /alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /local/ })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "alpha" } });
    expect(onConfigChange).toHaveBeenCalledWith({
      backend: "pinecone",
      index_name: "alpha",
      dimension: 768,
    });
  });

  it("switching the backend clears the previously selected index", () => {
    const onConfigChange = vi.fn();
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_INDEXER, {
          backend: "pinecone",
          index_name: "alpha",
          dimension: 768,
        })}
        onConfigChange={onConfigChange}
        onLabelChange={() => undefined}
        vectorIndexes={indexes}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /pgvector/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ backend: "pgvector" });
  });

  it("legacy backend-pinned nodes get the index picker but no backend picker", () => {
    render(
      <PipelineInspector
        selectedNode={makeNode("retriever.pgvector", {})}
        onConfigChange={() => undefined}
        onLabelChange={() => undefined}
        vectorIndexes={indexes}
      />,
    );

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /local/ })).toBeInTheDocument();
  });

  it("opens the index manager from the create sentinel", () => {
    const onOpenIndexManager = vi.fn();
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" })}
        onConfigChange={() => undefined}
        onLabelChange={() => undefined}
        vectorIndexes={indexes}
        onOpenIndexManager={onOpenIndexManager}
      />,
    );

    fireEvent.change(screen.getByLabelText(INDEX_SELECT_LABEL), {
      target: { value: "__create__" },
    });
    expect(onOpenIndexManager).toHaveBeenCalled();
  });

  it("clearing the index removes index_name and dimension", () => {
    const onConfigChange = vi.fn();
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_INDEXER, {
          backend: "pinecone",
          index_name: "alpha",
          dimension: 768,
        })}
        onConfigChange={onConfigChange}
        onLabelChange={() => undefined}
        vectorIndexes={indexes}
      />,
    );

    fireEvent.change(screen.getByLabelText(INDEX_SELECT_LABEL), { target: { value: "" } });
    expect(onConfigChange).toHaveBeenCalledWith({ backend: "pinecone" });
  });

  it("renders the embedding selector for embedder nodes and forwards the pick", () => {
    const onSelectEmbeddingModel = vi.fn();
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_EMBEDDER, { model_name: "emb-1" })}
        onConfigChange={() => undefined}
        onLabelChange={() => undefined}
        embeddingModels={[{ id: "emb-1", name: "Embedding One", dimension: 768 }]}
        onSelectEmbeddingModel={onSelectEmbeddingModel}
      />,
    );

    expect(screen.getByTestId("embedding-selector")).toBeInTheDocument();
    expect(lastEmbeddingProps).toMatchObject({ selectedModelKey: "emb-1" });
    (lastEmbeddingProps?.onSelectModel as (id: string) => void)("emb-2");
    expect(onSelectEmbeddingModel).toHaveBeenCalledWith("emb-2");
  });

  it("edits the node label", () => {
    const onLabelChange = vi.fn();
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_PARSER)}
        onConfigChange={() => undefined}
        onLabelChange={onLabelChange}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("Node"), { target: { value: "Renamed" } });
    expect(onLabelChange).toHaveBeenCalledWith("Renamed");
  });

  it("surfaces validation errors", () => {
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" })}
        onConfigChange={() => undefined}
        onLabelChange={() => undefined}
        validationErrors={["An index is required."]}
      />,
    );

    expect(screen.getByText("An index is required.")).toBeInTheDocument();
  });

  it("renders preview mode read-only", () => {
    render(
      <PipelineInspector
        selectedNode={makeNode(NODE_TYPE_PARSER)}
        onConfigChange={() => undefined}
        onLabelChange={() => undefined}
        isPreview
      />,
    );

    expect(screen.getByText(/Preview only/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Node")).toHaveAttribute("readonly");
  });
});
