import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NodeEditorDrawer } from "@/components/pipelines/NodeEditorDrawer";
import { makeCatalogModel, makeModelCatalog } from "@/test/fixtures";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { VectorIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";
import type { ComponentProps } from "react";

const NODE_TYPE_EMBEDDER = "embedder.text";
const NODE_TYPE_INDEXER = "indexer.vector";
const NODE_TYPE_PARSER = "parser.document";
const INDEX_SELECT_LABEL = "Vector index";
const SAVE_NODE = "Save node";
const CLOSE_EDITOR = "Close node editor";
const RENAMED_LABEL = "Renamed";
const NODE_LABEL = "Node label";

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

type DrawerProps = ComponentProps<typeof NodeEditorDrawer>;

const renderDrawer = (overrides: Partial<DrawerProps> = {}) => {
  const props: DrawerProps = {
    node: makeNode(NODE_TYPE_PARSER),
    onClose: () => undefined,
    onApply: () => undefined,
    isPreview: false,
    validationErrors: [],
    vectorIndexes: [],
    embeddingModels: [],
    embeddingCatalog: null,
    embeddingModelsLoading: false,
    embeddingModelsError: null,
    ...overrides,
  };
  return render(<NodeEditorDrawer {...props} />);
};

describe("NodeEditorDrawer", () => {
  beforeEach(() => {
    parameterInputMock.mockClear();
    lastEmbeddingProps = null;
  });

  it("renders nothing when no node is selected", () => {
    renderDrawer({ node: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("accumulates field edits in the draft and applies them on Save node", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    renderDrawer({
      node: makeNode(
        NODE_TYPE_PARSER,
        { mode: "auto" },
        { properties: { mode: { type: "string" } } },
      ),
      onApply,
      onClose,
    });

    const saveButton = screen.getByRole("button", { name: SAVE_NODE });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByText("trigger-text"));
    // Nothing applied yet -- edits live in the draft until Save node.
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(saveButton);
    expect(onApply).toHaveBeenCalledWith("node-1", { label: "Node", config: { mode: "text" } });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes directly while clean, via the close button and Escape", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole("button", { name: CLOSE_EDITOR }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("asks for confirmation before closing with unsaved draft edits", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    renderDrawer({
      node: makeNode(
        NODE_TYPE_PARSER,
        { mode: "auto" },
        { properties: { mode: { type: "string" } } },
      ),
      onApply,
      onClose,
    });

    fireEvent.click(screen.getByText("trigger-text"));
    fireEvent.click(screen.getByRole("button", { name: CLOSE_EDITOR }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Discard node edits?")).toBeInTheDocument();

    // Cancel keeps editing.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();

    // Discard closes without applying.
    fireEvent.click(screen.getByRole("button", { name: CLOSE_EDITOR }));
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("filters the index picker to the node's configured backend and saves the pick", () => {
    const onApply = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" }),
      onApply,
      vectorIndexes: indexes,
    });

    const select = screen.getByLabelText(INDEX_SELECT_LABEL);
    expect(screen.getByRole("option", { name: /alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /local/ })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_NODE }));
    expect(onApply).toHaveBeenCalledWith("node-1", {
      label: "Node",
      config: { backend: "pinecone", index_name: "alpha", dimension: 768 },
    });
  });

  it("switching the backend clears the previously selected index in the draft", () => {
    const onApply = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: "pinecone",
        index_name: "alpha",
        dimension: 768,
      }),
      onApply,
      vectorIndexes: indexes,
    });

    fireEvent.click(screen.getByRole("radio", { name: /pgvector/i }));
    fireEvent.click(screen.getByRole("button", { name: SAVE_NODE }));
    expect(onApply).toHaveBeenCalledWith("node-1", {
      label: "Node",
      config: { backend: "pgvector" },
    });
  });

  it("legacy backend-pinned nodes get the index picker but no backend picker", () => {
    renderDrawer({
      node: makeNode("retriever.pgvector", {}),
      vectorIndexes: indexes,
    });

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /local/ })).toBeInTheDocument();
  });

  it("opens the index manager from the create sentinel", () => {
    const onOpenIndexManager = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" }),
      vectorIndexes: indexes,
      onOpenIndexManager,
    });

    fireEvent.change(screen.getByLabelText(INDEX_SELECT_LABEL), {
      target: { value: "__create__" },
    });
    expect(onOpenIndexManager).toHaveBeenCalled();
  });

  it("clearing the index removes index_name and dimension from the draft", () => {
    const onApply = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: "pinecone",
        index_name: "alpha",
        dimension: 768,
      }),
      onApply,
      vectorIndexes: indexes,
    });

    fireEvent.change(screen.getByLabelText(INDEX_SELECT_LABEL), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_NODE }));
    expect(onApply).toHaveBeenCalledWith("node-1", {
      label: "Node",
      config: { backend: "pinecone" },
    });
  });

  it("picking an embedding model updates the draft and never keeps a stale dimension", () => {
    const onApply = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_EMBEDDER, {
        connection_id: "conn-openrouter-1",
        model_name: "emb-1",
        dimension: 768,
      }),
      embeddingModels: [
        makeCatalogModel({ id: "emb-1", name: "Embedding One", dimension: 768 }),
        makeCatalogModel({ id: "emb-2", name: "Embedding Two" }),
      ],
      onApply,
    });

    expect(screen.getByTestId("embedding-selector")).toBeInTheDocument();
    expect(lastEmbeddingProps).toMatchObject({ selectedModelKey: "emb-1" });
    act(() => {
      (lastEmbeddingProps?.onSelectModel as (model: unknown) => void)(
        makeCatalogModel({ id: "emb-2", name: "Embedding Two" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: SAVE_NODE }));
    // No explicit dimension: most embedding models reject a `dimensions`
    // override, so the draft carries only the connection + model.
    expect(onApply).toHaveBeenCalledWith("node-1", {
      label: "Node",
      config: { connection_id: "conn-openrouter-1", model_name: "emb-2" },
    });
  });

  it("blocks node edits when a refreshed catalog no longer contains the selected model", () => {
    const onApply = vi.fn();
    const otherConnection = makeCatalogModel({ connection_id: "conn-b", id: "removed-model" });
    renderDrawer({
      node: makeNode(NODE_TYPE_EMBEDDER, {
        connection_id: "conn-a",
        model_name: "removed-model",
      }),
      embeddingModels: [otherConnection],
      embeddingCatalog: makeModelCatalog([otherConnection]),
      onApply,
    });

    fireEvent.change(screen.getByLabelText(NODE_LABEL), { target: { value: RENAMED_LABEL } });
    const saveButton = screen.getByRole("button", { name: SAVE_NODE });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("saves a label edit through the draft", () => {
    const onApply = vi.fn();
    renderDrawer({ onApply });

    fireEvent.change(screen.getByLabelText(NODE_LABEL), { target: { value: RENAMED_LABEL } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_NODE }));
    expect(onApply).toHaveBeenCalledWith("node-1", { label: RENAMED_LABEL, config: {} });
  });

  it("surfaces validation errors", () => {
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" }),
      validationErrors: ["An index is required."],
    });

    expect(screen.getByText("An index is required.")).toBeInTheDocument();
  });

  it("preview mode is read-only with an Add to canvas action", () => {
    const onAddToCanvas = vi.fn();
    renderDrawer({ isPreview: true, onAddToCanvas });

    // The label renders as a heading, not an editable input, and there is no
    // local save in preview mode.
    expect(screen.queryByLabelText(NODE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SAVE_NODE })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Node" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add to canvas/ }));
    expect(onAddToCanvas).toHaveBeenCalled();
  });
});
