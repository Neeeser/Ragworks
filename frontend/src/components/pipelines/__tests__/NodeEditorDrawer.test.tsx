import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NodeEditorDrawer } from "@/components/pipelines/NodeEditorDrawer";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { makeCatalogModel, makeModelCatalog } from "@/test/fixtures";

import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { PipelineVariable, VectorIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";
import type { ComponentProps } from "react";

const NODE_TYPE_EMBEDDER = "embedder.text";
const NODE_TYPE_INDEXER = "indexer.vector";
const NODE_TYPE_PARSER = "parse.text";
const NODE_TYPE_RERANKER = "reranker.model";
const RERANKER_MODEL_ID = "reranker-1";
const INDEX_SELECT_LABEL = "Vector index";
const SAVE_NODE = "Save node";
const CLOSE_EDITOR = "Close node editor";
const RENAMED_LABEL = "Renamed";
const NODE_LABEL = "Node label";
const NODE_TYPE_CHUNKER = "chunker.token";
const TOKENIZER_SELECT = "Tokenizer";
const DISCARD_PROMPT = "Discard node edits?";
const CLEAR_INDEX_OPTION = "Select an index";

const parameterInputMock = vi.fn();
let lastEmbeddingProps: Record<string, unknown> | null = null;
let lastRerankingProps: Record<string, unknown> | null = null;

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

vi.mock("@/components/pipelines/RerankingModelSelectorCard", () => ({
  RerankingModelSelectorCard: (props: Record<string, unknown>) => {
    lastRerankingProps = props;
    return <div data-testid="reranking-selector" />;
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

const SEMANTIC_VARIABLE: PipelineVariable = {
  name: "semantic_index",
  type: "index",
  source: "value",
  description: "Semantic index this pipeline uses",
  value: { index_id: "row-1", backend: "pinecone", name: "alpha" },
};

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
    rerankingModels: [],
    rerankingCatalog: null,
    rerankingModelsLoading: false,
    rerankingModelsError: null,
    onRetryRerankingModels: () => undefined,
    llmModels: [],
    llmCatalog: null,
    llmModelsLoading: false,
    llmModelsError: null,
    onRetryLlmModels: () => undefined,
    hasRerankingProvider: true,
    variables: [],
    ...overrides,
  };
  return render(<NodeEditorDrawer {...props} />);
};

function DrawerWithIndexRegistry() {
  const [managerOpen, setManagerOpen] = React.useState(false);
  return (
    <>
      <NodeEditorDrawer
        node={makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" })}
        onClose={() => undefined}
        onApply={() => undefined}
        isPreview={false}
        variables={[]}
        validationErrors={[]}
        vectorIndexes={indexes}
        onOpenIndexRegistry={() => setManagerOpen(true)}
        embeddingModels={[]}
        embeddingCatalog={null}
        embeddingModelsLoading={false}
        embeddingModelsError={null}
        rerankingModels={[]}
        rerankingCatalog={null}
        rerankingModelsLoading={false}
        rerankingModelsError={null}
        onRetryRerankingModels={() => undefined}
        llmModels={[]}
        llmCatalog={null}
        llmModelsLoading={false}
        llmModelsError={null}
        onRetryLlmModels={() => undefined}
        hasRerankingProvider
      />
      <ModalOverlay
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        labelledBy="index-registry-title"
      >
        <div>
          <h2 id="index-registry-title">Index registry</h2>
          <button type="button">Manager action</button>
        </div>
      </ModalOverlay>
    </>
  );
}

function DrawerWithDraftParent() {
  const [draft, setDraft] = React.useState<Record<string, unknown> | null>(null);
  return (
    <>
      <NodeEditorDrawer
        node={makeNode(
          NODE_TYPE_PARSER,
          { chunk_size: 512 },
          { properties: { chunk_size: { type: "integer" } } },
        )}
        onClose={() => undefined}
        onApply={() => undefined}
        onDraftChange={(_nodeId, config) => setDraft(config)}
        isPreview={false}
        variables={[]}
        validationErrors={[]}
        vectorIndexes={[]}
        embeddingModels={[]}
        embeddingCatalog={null}
        embeddingModelsLoading={false}
        embeddingModelsError={null}
        rerankingModels={[]}
        rerankingCatalog={null}
        rerankingModelsLoading={false}
        rerankingModelsError={null}
        onRetryRerankingModels={() => undefined}
        llmModels={[]}
        llmCatalog={null}
        llmModelsLoading={false}
        llmModelsError={null}
        onRetryLlmModels={() => undefined}
        hasRerankingProvider
      />
      <span data-testid="draft">{JSON.stringify(draft)}</span>
    </>
  );
}

describe("NodeEditorDrawer", () => {
  beforeEach(() => {
    parameterInputMock.mockClear();
    lastEmbeddingProps = null;
    lastRerankingProps = null;
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
        NODE_TYPE_CHUNKER,
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

    expect(screen.getByRole("combobox", { name: TOKENIZER_SELECT })).toBeInTheDocument();
    expect(screen.queryByLabelText("HuggingFace model id")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: TOKENIZER_SELECT }));
    await user.click(screen.getByRole("option", { name: "HuggingFace" }));

    expect(screen.getByLabelText("HuggingFace model id")).toBeInTheDocument();
  });

  it("counts the chunk window in the unit the configured tokenizer actually measures", async () => {
    // A whitespace-configured chunker counts whitespace-delimited words, which
    // is not what a model counts — the embedding guard says as much when it
    // refuses to enforce a provider limit with that counter. Printing "tokens"
    // beside those numbers states the wrong unit for the field, and the whole
    // chunk-window math downstream is expressed in model tokens.
    const user = userEvent.setup();
    const chunkerSchema = {
      properties: {
        chunk_size: { type: "integer", default: 512 },
        chunk_overlap: { type: "integer", default: 64 },
        tokenizer: {
          type: "string",
          enum: ["wordpiece", "cl100k", "whitespace", "huggingface"],
          default: "wordpiece",
        },
      },
    };
    renderDrawer({
      node: makeNode(
        NODE_TYPE_CHUNKER,
        { chunk_size: 512, chunk_overlap: 64, tokenizer: "wordpiece" },
        chunkerSchema,
      ),
    });

    const windowText = () =>
      Array.from(document.querySelectorAll("p"))
        .map((paragraph) => paragraph.textContent ?? "")
        .find((text) => text.includes("sent to the embedder")) ?? "";

    expect(windowText()).toContain("576 tokens sent to the embedder");

    await user.click(screen.getByRole("combobox", { name: TOKENIZER_SELECT }));
    await user.click(screen.getByRole("option", { name: "Whitespace" }));

    expect(windowText()).toContain("576 words sent to the embedder");
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
    expect(screen.getByText(DISCARD_PROMPT)).toBeInTheDocument();

    // Cancel keeps editing.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();

    // Discard closes without applying.
    fireEvent.click(screen.getByRole("button", { name: CLOSE_EDITOR }));
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("closes without confirmation when an index swap lands back on the original", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDrawer({
      // Key order matters here: clearing the index deletes `index_name` and
      // `dimension`, and re-picking appends them back in the picker's order.
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: "pinecone",
        dimension: 768,
        index_name: "alpha",
      }),
      onClose,
      vectorIndexes: indexes,
    });

    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: CLEAR_INDEX_OPTION }));
    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: /alpha/ }));

    await user.click(screen.getByRole("button", { name: CLOSE_EDITOR }));
    expect(screen.queryByText(DISCARD_PROMPT)).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes without confirmation when the re-picked index supplies a dimension the node never stored", async () => {
    // A server-built pipeline names its index and no dimension; the picker
    // writes the registry's dimension on every pick, so re-picking the index
    // the node already targets must still count as no change.
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, { backend: "pinecone", index_name: "alpha" }),
      onClose,
      vectorIndexes: indexes,
    });

    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: CLEAR_INDEX_OPTION }));
    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: /alpha/ }));

    await user.click(screen.getByRole("button", { name: CLOSE_EDITOR }));
    expect(screen.queryByText(DISCARD_PROMPT)).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("asks for confirmation when an index swap leaves a different index selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: "pgvector",
        dimension: 384,
        index_name: "local",
      }),
      onClose,
      vectorIndexes: [...indexes, { name: "local-2", backend: "pgvector", dimension: 384 }],
    });

    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: /local-2/ }));

    await user.click(screen.getByRole("button", { name: CLOSE_EDITOR }));
    expect(screen.getByText(DISCARD_PROMPT)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
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

  it("reads an index held by a pipeline variable, not Required", () => {
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: { $expr: "semantic_index.backend" },
        index_name: { $expr: "semantic_index.name" },
      }),
      vectorIndexes: indexes,
      variables: [SEMANTIC_VARIABLE],
    });

    // The collection's Indexes card fills this in; "Required" would report a
    // correctly configured pipeline as unfinished.
    expect(screen.getByText("Named once for this pipeline")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Index variable" })).toBeInTheDocument();
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
  });

  it("declares a second index variable so one pipeline can hold two stores", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onDeclareIndexVariable = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: "pinecone",
        index_name: "alpha",
        dimension: 768,
      }),
      onApply,
      onDeclareIndexVariable,
      vectorIndexes: indexes,
      variables: [SEMANTIC_VARIABLE],
    });

    // A pipeline splitting its corpus needs one variable per store; pointing
    // every store at the same one merges two corpora into whichever is
    // written last.
    await user.click(screen.getByRole("radio", { name: /Pipeline variable/ }));
    await user.click(screen.getByRole("combobox", { name: "Index variable" }));
    await user.click(screen.getByRole("option", { name: "+ New variable…" }));
    await user.type(screen.getByLabelText("Variable name"), "facts_semantic");
    await user.click(screen.getByRole("button", { name: "Add variable" }));

    expect(onDeclareIndexVariable).toHaveBeenCalledWith({
      name: "facts_semantic",
      vectorType: "dense",
      index: expect.objectContaining({ name: "alpha" }),
    });
    await user.click(screen.getByRole("button", { name: SAVE_NODE }));
    expect(onApply).toHaveBeenCalledWith("node-1", {
      label: "Node",
      config: {
        backend: { $expr: "facts_semantic.backend" },
        index_name: { $expr: "facts_semantic.name" },
      },
    });
  });

  it("returning to a named index clears the variable off both identity fields", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, {
        backend: { $expr: "semantic_index.backend" },
        index_name: { $expr: "semantic_index.name" },
      }),
      onApply,
      vectorIndexes: indexes,
      variables: [SEMANTIC_VARIABLE],
    });

    await user.click(screen.getByRole("radio", { name: /This pipeline/ }));
    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: /local/ }));
    await user.click(screen.getByRole("button", { name: SAVE_NODE }));

    // Leaving `backend` as an expression keeps the node reading a variable it
    // no longer names.
    expect(onApply).toHaveBeenCalledWith("node-1", {
      label: "Node",
      config: { backend: "pgvector", index_name: "local", dimension: 384 },
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

    expect(
      screen.queryByRole("radiogroup", { name: "Vector store backend" }),
    ).not.toBeInTheDocument();
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

  it("keeps focus in the index registry opened from the create sentinel", async () => {
    const user = userEvent.setup();
    render(<DrawerWithIndexRegistry />);

    await user.click(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL }));
    await user.click(screen.getByRole("option", { name: /Add new index/ }));

    expect(screen.getByRole("dialog", { name: "Index registry" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("option", { name: CLEAR_INDEX_OPTION }));
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

  it("configures a reranker with only its connection-qualified model", () => {
    const onApply = vi.fn();
    const model = makeCatalogModel({
      connection_id: "reranking-connection",
      id: RERANKER_MODEL_ID,
    });
    renderDrawer({
      node: makeNode(
        NODE_TYPE_RERANKER,
        { top_n: 2, top_k: 3, enabled: false },
        {
          properties: {
            connection_id: { type: "string" },
            model_name: { type: "string" },
          },
        },
      ),
      rerankingModels: [model],
      rerankingCatalog: makeModelCatalog([model]),
      onApply,
    });

    expect(screen.getByTestId("reranking-selector")).toBeInTheDocument();
    act(() => {
      (lastRerankingProps?.onSelectModel as (selected: unknown) => void)(model);
    });
    fireEvent.click(screen.getByRole("button", { name: SAVE_NODE }));

    expect(onApply).toHaveBeenCalledWith("node-1", {
      label: "Node",
      config: { connection_id: "reranking-connection", model_name: RERANKER_MODEL_ID },
    });
  });

  it("keeps a missing saved reranker visible and blocks saving it", () => {
    const onApply = vi.fn();
    const otherModel = makeCatalogModel({ connection_id: "other", id: RERANKER_MODEL_ID });
    renderDrawer({
      node: makeNode(NODE_TYPE_RERANKER, {
        connection_id: "removed",
        model_name: RERANKER_MODEL_ID,
      }),
      rerankingModels: [otherModel],
      rerankingCatalog: makeModelCatalog([otherModel]),
      onApply,
    });

    expect(lastRerankingProps).toMatchObject({
      selectedConnectionId: "removed",
      selectedModelKey: RERANKER_MODEL_ID,
      selectedAvailability: "missing",
    });
    fireEvent.change(screen.getByLabelText(NODE_LABEL), { target: { value: RENAMED_LABEL } });
    expect(screen.getByRole("button", { name: SAVE_NODE })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("disables preview add-to-canvas when no reranking provider exists", () => {
    const onAddToCanvas = vi.fn();
    renderDrawer({
      node: makeNode(NODE_TYPE_RERANKER),
      isPreview: true,
      hasRerankingProvider: false,
      onAddToCanvas,
    });

    expect(screen.getByRole("button", { name: "Add to canvas" })).toBeDisabled();
    expect(screen.getByText("Add a reranking provider to continue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
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
        NODE_TYPE_CHUNKER,
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

  it("reports every draft change without updating the parent mid-render", async () => {
    const user = userEvent.setup();
    const consoleErrors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    });

    try {
      // StrictMode as the dev server runs it: React double-invokes state
      // updaters during render there, so an impure one reports every time.
      render(
        <React.StrictMode>
          <DrawerWithDraftParent />
        </React.StrictMode>,
      );
      const toggle = () => screen.getByRole("button", { name: "Toggle expression mode" });
      // Repeated literal <-> expression switching: React only evaluates the
      // first state updater outside the render phase, so a side effect inside
      // one shows up from the second toggle on.
      await user.click(toggle());
      await user.click(toggle());
      await user.click(toggle());

      expect(consoleErrors.join("\n")).not.toContain("while rendering a different component");
      expect(screen.getByTestId("draft")).toHaveTextContent('{"chunk_size":{"$expr":""}}');
    } finally {
      spy.mockRestore();
    }
  });

  it("disables the index selector in preview mode", () => {
    renderDrawer({
      node: makeNode(NODE_TYPE_INDEXER, { backend: "pinecone" }),
      vectorIndexes: indexes,
      isPreview: true,
    });

    expect(screen.getByRole("combobox", { name: INDEX_SELECT_LABEL })).toBeDisabled();
  });

  it("shows a modality finding that names no config field", () => {
    // A modality finding is about how the node is wired, so it carries a
    // node id and no field — without a node-scoped display it reaches the
    // client and is rendered nowhere.
    renderDrawer({
      validationIssues: [
        {
          message: "Image items produced by node 'image-in' reach no index that accepts them.",
          severity: "warning",
          code: "modality.lost_modality",
          node_id: "image-in",
          field: null,
          configured_value: null,
          model: null,
          allowed_max: null,
        },
      ],
    });

    expect(screen.getByText(/reach no index that accepts them/)).toBeInTheDocument();
  });
});
