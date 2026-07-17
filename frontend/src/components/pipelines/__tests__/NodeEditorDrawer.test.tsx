import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NodeEditorDrawer } from "@/components/pipelines/NodeEditorDrawer";
import { ModalOverlay } from "@/components/ui/modal-overlay";
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
    error,
    errorId,
    controlId,
    children,
  }: {
    label: string;
    helper?: string | null;
    error?: string | null;
    errorId?: string;
    controlId?: string;
    children: React.ReactNode;
  }) => (
    <div>
      <label htmlFor={controlId}>{label}</label>
      {helper && <span>{helper}</span>}
      {children}
      {error && <span id={errorId}>{error}</span>}
    </div>
  ),
  ParameterInput: (props: {
    input: string;
    id?: string;
    ariaInvalid?: boolean;
    ariaDescribedBy?: string;
    onChange: (value: string | boolean) => void;
  }) => {
    parameterInputMock(props);
    if (props.input !== "integer" && props.input !== "number") {
      return (
        <button
          id={props.id}
          type="button"
          aria-describedby={props.ariaDescribedBy}
          onClick={() =>
            props.onChange(
              props.input === "boolean" ? true : props.input === "select" ? "huggingface" : "text",
            )
          }
        >
          {`trigger-${props.input}`}
        </button>
      );
    }
    return (
      <input
        id={props.id}
        type="number"
        aria-invalid={props.ariaInvalid || undefined}
        aria-describedby={props.ariaDescribedBy}
        onClick={() => {
          if (props.input === "number") props.onChange("1.2");
          else props.onChange("3");
        }}
      />
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
    validationIssues: [],
    vectorIndexes: [],
    embeddingModels: [],
    embeddingCatalog: null,
    embeddingModelsLoading: false,
    embeddingModelsError: null,
    variables: [],
    variableNodes: [],
    ...overrides,
  };
  return render(<NodeEditorDrawer {...props} />);
};

function DrawerWithIndexManager() {
  const [managerOpen, setManagerOpen] = React.useState(false);
  return (
    <>
      <NodeEditorDrawer
        node={makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" })}
        onClose={() => undefined}
        onApply={() => undefined}
        isPreview={false}
        variables={[]}
        variableNodes={[]}
        validationErrors={[]}
        vectorIndexes={indexes}
        onOpenIndexManager={() => setManagerOpen(true)}
        embeddingModels={[]}
        embeddingCatalog={null}
        embeddingModelsLoading={false}
        embeddingModelsError={null}
      />
      <ModalOverlay
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        labelledBy="index-manager-title"
      >
        <div>
          <h2 id="index-manager-title">Index manager</h2>
          <button type="button">Manager action</button>
        </div>
      </ModalOverlay>
    </>
  );
}

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

  it("shows the HuggingFace model field only for the HuggingFace chunker tokenizer", async () => {
    const user = userEvent.setup();
    renderDrawer({
      node: makeNode(
        "chunker.token",
        { tokenizer: "wordpiece" },
        {
          properties: {
            tokenizer: {
              type: "string",
              enum: ["wordpiece", "cl100k", "whitespace", "huggingface"],
              default: "wordpiece",
            },
            hf_model_id: {
              anyOf: [{ type: "string" }, { type: "null" }],
              default: null,
            },
          },
        },
      ),
    });

    expect(screen.getByRole("combobox", { name: "Tokenizer" })).toBeInTheDocument();
    expect(screen.queryByLabelText("HuggingFace model id")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Tokenizer" }));
    await user.click(screen.getByRole("option", { name: "HuggingFace" }));

    expect(screen.getByLabelText("HuggingFace model id")).toBeInTheDocument();
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

  it("filters the index picker to the node's configured backend and saves the pick", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" }),
      onApply,
      vectorIndexes: indexes,
    });

    const select = screen.getByRole("combobox", { name: INDEX_SELECT_LABEL });
    await user.click(select);
    expect(select).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /local/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /alpha/ }));
    await user.click(screen.getByRole("button", { name: SAVE_NODE }));
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

  it("legacy backend-pinned nodes get the index picker but no backend picker", async () => {
    const user = userEvent.setup();
    renderDrawer({
      node: makeNode("retriever.pgvector", {}),
      vectorIndexes: indexes,
    });

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    expect(screen.getByRole("option", { name: /local/ })).toBeInTheDocument();
  });

  it("displays and selects an index that has not been created yet", async () => {
    const user = userEvent.setup();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: "pinecone",
        index_name: "missing",
        dimension: 768,
      }),
      vectorIndexes: indexes,
    });

    const select = screen.getByRole("combobox", { name: INDEX_SELECT_LABEL });
    expect(select).toHaveTextContent("missing (not created yet)");

    await user.click(select);
    expect(screen.getByRole("option", { name: "missing (not created yet)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps focus in the index manager opened from the create sentinel", async () => {
    const user = userEvent.setup();
    render(<DrawerWithIndexManager />);

    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: /Add new index/ }));

    expect(screen.getByRole("dialog", { name: "Index manager" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manager action" })).toHaveFocus();
  });

  it("clearing the index removes index_name and dimension from the draft", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: "Select an index" }));
    await user.click(screen.getByRole("button", { name: SAVE_NODE }));
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

  it("renders a structured chunk-size error beside the chunk-size field", () => {
    renderDrawer({
      node: makeNode(
        "chunker.token",
        { chunk_size: 1024 },
        {
          properties: {
            chunk_size: { type: "integer", title: "Chunk Size", default: 512 },
          },
        },
      ),
      validationIssues: [
        {
          code: "embedding_input_limit_exceeded",
          message:
            "Chunk size 1,024 exceeds sentence-transformers/all-minilm-l6-v2's 512-token input limit.",
          severity: "error",
          node_id: "node-1",
          field: "chunk_size",
          configured_value: 1024,
          model: "sentence-transformers/all-minilm-l6-v2",
          allowed_max: 512,
        },
      ],
    });

    const message = screen.getByText(/Chunk size 1,024 exceeds/);
    const input = screen.getByRole("spinbutton", { name: "Chunk Size" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", message.id);
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

  it("disables the index selector in preview mode", () => {
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" }),
      vectorIndexes: indexes,
      isPreview: true,
    });

    expect(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL })).toBeDisabled();
  });
});
