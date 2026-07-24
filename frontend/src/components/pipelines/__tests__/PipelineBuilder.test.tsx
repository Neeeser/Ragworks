import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineBuilder } from "@/components/pipelines/PipelineBuilder";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import {
  makeCollection,
  makeNodeSpec,
  makePipeline,
  makePipelineVersion,
  makeCatalogModel,
} from "@/test/fixtures";

import type { NodeSpec, Pipeline, PipelineVersion } from "@/lib/types";
import type { Connection, Edge, Node } from "@xyflow/react";
import type { DragEvent } from "react";

const io = {
  validatePipelineConnection: vi.fn(),
  validatePipelineEdges: vi.fn(),
  validatePipelineConfig: vi.fn(),
};

let lastCanvasProps: Record<string, unknown> | null = null;
let lastDrawerProps: Record<string, unknown> | null = null;
let lastSidebarProps: Record<string, unknown> | null = null;
const baseTimestamp = "2024-01-01T00:00:00.000Z";
const embedderType = "embedder.openrouter";
const rerankerType = "reranker.model";
const rerankerProviderRequired = "Add a reranking provider to continue";
const rerankerProviderLoading = "Checking reranking providers…";
const rerankerProviderError = "Unable to load provider connections.";
const savePipelineLabel = "Save pipeline";
const openSaveLabel = "Open save dialog";
const openHistoryLabel = "Open history";
const saveNodeEditsLabel = "Save node edits";
const selectNodeLabel = "Select node";
const deletePipelineLabel = "Delete pipeline";
const confirmDeleteLabel = "Confirm delete";
const hfModelId = "owner/model";
const buildDragEvent = (type: string) =>
  ({
    preventDefault: vi.fn(),
    dataTransfer: {
      getData: vi.fn(() => type),
      dropEffect: "",
    },
    clientX: 200,
    clientY: 150,
  }) as unknown as DragEvent<HTMLDivElement>;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "token" }),
);

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

vi.mock("@/components/pipelines/lib/pipeline-io", () => ({
  validatePipelineConnection: (...args: unknown[]) => io.validatePipelineConnection(...args),
  validatePipelineEdges: (...args: unknown[]) => io.validatePipelineEdges(...args),
  validatePipelineConfig: (...args: unknown[]) => io.validatePipelineConfig(...args),
}));

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");
  return {
    addEdge: (edge: Edge, edges: Edge[]) => [...edges, edge],
    useNodesState: <T extends Record<string, unknown>>(initial: Node<T>[]) => {
      const [nodes, setNodes] = ReactModule.useState(initial);
      return [nodes, setNodes, vi.fn()];
    },
    useEdgesState: (initial: Edge[]) => {
      const [edges, setEdges] = ReactModule.useState(initial);
      return [edges, setEdges, vi.fn()];
    },
  };
});

vi.mock("@/components/pipelines/PipelineCanvas", () => ({
  PipelineCanvas: (props: Record<string, unknown>) => {
    lastCanvasProps = props;
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            (props.onConnect as (c: Connection) => void)?.({
              source: "a",
              target: "b",
              sourceHandle: "out",
              targetHandle: "in",
            })
          }
        >
          Connect
        </button>
        <button
          type="button"
          onClick={() => (props.onNodeSelect as (id: string) => void)?.("node-1")}
        >
          Select node
        </button>
        <button type="button" onClick={() => (props.onNoticeDismiss as () => void)?.()}>
          Dismiss notice
        </button>
        <div data-testid="canvas">{props.notice as string}</div>
      </div>
    );
  },
}));

vi.mock("@/components/pipelines/NodeEditorDrawer", () => ({
  NodeEditorDrawer: (props: Record<string, unknown>) => {
    lastDrawerProps = props;
    const node = props.node as { id?: string; data?: { config?: Record<string, unknown> } } | null;
    const apply = props.onApply as (
      nodeId: string,
      edits: { label: string; config: Record<string, unknown> },
    ) => void;
    return (
      <div>
        {(props.validationIssues as Array<{ message: string; field?: string }> | undefined)?.map(
          (issue) => (
            <div role="alert" key={`${issue.field ?? "issue"}-${issue.message}`}>
              {issue.field ? `${issue.field}: ` : ""}
              {issue.message}
            </div>
          ),
        )}
        <button
          type="button"
          onClick={() => (props.onOpenIndexManager as (flag?: boolean) => void)?.(true)}
        >
          Open index manager
        </button>
        <button
          type="button"
          onClick={() =>
            node?.id &&
            apply(node.id, {
              label: "Label",
              config: { ...node.data?.config, model_name: "emb-1" },
            })
          }
        >
          Save node edits
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/pipelines/SaveVersionDialog", () => ({
  SaveVersionDialog: ({
    open,
    onSave,
    validationMessage,
    validationIssues,
  }: {
    open: boolean;
    onSave: () => void;
    validationMessage?: string | null;
    validationIssues?: Array<{ message: string; field?: string }>;
  }) =>
    open ? (
      <div role="dialog">
        {validationMessage ? (
          <div role="alert">
            {validationMessage}
            {validationIssues?.map((issue) => (
              <span key={issue.message}>
                {issue.field}: {issue.message}
              </span>
            ))}
          </div>
        ) : null}
        <button type="button" onClick={onSave}>
          Save pipeline
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/pipelines/RevisionHistoryDialog", () => ({
  RevisionHistoryDialog: ({
    open,
    onActivate,
    versions,
  }: {
    open: boolean;
    onActivate: (version: PipelineVersion) => void;
    versions: PipelineVersion[];
  }) =>
    open ? (
      <button type="button" onClick={() => onActivate(versions[0])}>
        Activate
      </button>
    ) : null,
}));

vi.mock("@/components/pipelines/PipelineSidebar", () => ({
  PipelineSidebar: (props: {
    pipelines: Pipeline[];
    onSelectPipeline: (p: Pipeline) => void;
    onDeletePipeline: (p: Pipeline) => void;
    onPreviewNode?: (spec: NodeSpec) => void;
    catalog?: { specs: NodeSpec[] }[] | undefined;
  }) =>
    (() => {
      lastSidebarProps = props as Record<string, unknown>;
      const { pipelines, onSelectPipeline, onDeletePipeline, onPreviewNode, catalog } = props;
      return (
        <div>
          <button type="button" onClick={() => onSelectPipeline(pipelines[0])}>
            Select pipeline
          </button>
          <button type="button" onClick={() => onDeletePipeline(pipelines[0])}>
            Delete pipeline
          </button>
          <button
            type="button"
            onClick={() => {
              const family = catalog?.[0];
              const spec = family?.specs?.[0];
              if (spec && onPreviewNode) {
                onPreviewNode(spec);
              }
            }}
          >
            Preview node
          </button>
        </div>
      );
    })(),
}));

vi.mock("@/components/pipelines/PipelineHeader", () => ({
  PipelineHeader: ({
    onCreatePipeline,
    onManageIndexes,
    onOpenSave,
    onOpenHistory,
  }: {
    onCreatePipeline: () => void;
    onManageIndexes: () => void;
    onOpenSave: () => void;
    onOpenHistory: () => void;
  }) => (
    <div>
      <button type="button" onClick={onCreatePipeline}>
        Create pipeline
      </button>
      <button type="button" onClick={onManageIndexes}>
        Manage indexes
      </button>
      <button type="button" onClick={onOpenSave}>
        Open save dialog
      </button>
      <button type="button" onClick={onOpenHistory}>
        Open history
      </button>
    </div>
  ),
}));

vi.mock("@/components/pipelines/CreatePipelineWizard", () => ({
  CreatePipelineWizard: ({
    open,
    onCreated,
    onOpenIndexManager,
  }: {
    open: boolean;
    onCreated: (pipeline: Pipeline) => void;
    onOpenIndexManager?: () => void;
  }) =>
    open ? (
      <div>
        <button
          type="button"
          onClick={() =>
            onCreated({
              id: "new",
              user_id: "user",
              name: "New",
              kind: "ingestion",
              current_version: 1,
              is_default: false,
              created_at: baseTimestamp,
              updated_at: baseTimestamp,
              definition: { nodes: [], edges: [] },
              validation_issues: [
                {
                  message: "Chunking may exceed the model limit.",
                  severity: "warning",
                },
              ],
            })
          }
        >
          Finish create
        </button>
        <button type="button" onClick={onOpenIndexManager}>
          Open indexes from wizard
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/pipelines/index-manager/IndexManagerModal", () => ({
  IndexManagerModal: ({
    open,
    onClose,
    onRefresh,
  }: {
    open: boolean;
    onClose: () => void;
    onRefresh: () => void;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onRefresh}>
          Refresh indexes
        </button>
        <button type="button" onClick={onClose}>
          Close indexes
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    title,
    confirmLabel,
    rememberLabel,
    rememberChecked,
    onRememberChange,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    confirmLabel?: string;
    rememberLabel?: string;
    rememberChecked?: boolean;
    onRememberChange?: (checked: boolean) => void;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <p>{title}</p>
        {rememberLabel && onRememberChange ? (
          <label>
            <input
              type="checkbox"
              checked={rememberChecked}
              onChange={(event) => onRememberChange(event.target.checked)}
            />
            {rememberLabel}
          </label>
        ) : null}
        <button type="button" onClick={onConfirm}>
          {title.toLowerCase().includes("delete") ? confirmDeleteLabel : confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel delete
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/loader", () => ({
  Loader: () => <span>Loading</span>,
}));

const pipeline: Pipeline = makePipeline({
  name: "Pipeline",
  kind: "ingestion",
  definition: {
    nodes: [
      {
        id: "node-1",
        type: embedderType,
        name: "Embed",
        config: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    viewport: {},
  },
});

const nodeSpecs: NodeSpec[] = [
  makeNodeSpec({
    type: embedderType,
    label: "Embedder",
    category: "ingestion",
    description: "",
    input_ports: [],
    output_ports: [],
  }),
];

describe("PipelineBuilder", () => {
  beforeEach(() => {
    lastCanvasProps = null;
    lastDrawerProps = null;
    lastSidebarProps = null;
    api.fetchPipelines.mockResolvedValue([pipeline]);
    api.fetchPipelineNodes.mockResolvedValue(nodeSpecs);
    api.fetchCollections.mockResolvedValue([]);
    api.fetchEmbeddingModels.mockResolvedValue({
      models: [],
      connection_errors: [],
      meta: { freshness: "fresh", age_seconds: 0, refreshing: false, warning: null },
    });
    api.listIndexes.mockResolvedValue([]);
    api.listPipelineVersions.mockResolvedValue([makePipelineVersion({ id: "v1" })]);
    api.validatePipeline.mockResolvedValue({ valid: true, errors: [], warnings: [], issues: [] });
    api.updatePipeline.mockResolvedValue(pipeline);
    api.activatePipelineVersion.mockResolvedValue(pipeline);
    api.ensureHuggingFaceTokenizer.mockResolvedValue({
      model_id: hfModelId,
      cached: true,
    });

    io.validatePipelineConnection.mockReturnValue({ valid: true });
    io.validatePipelineEdges.mockReturnValue({ edgeErrors: {}, nodeErrors: {} });
    io.validatePipelineConfig.mockReturnValue({ nodeErrors: {} });
  });

  it("loads pipelines and handles create flow", async () => {
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => {
      expect(api.fetchPipelines).toHaveBeenCalled();
    });
    await waitFor(() =>
      expect(lastSidebarProps).toMatchObject({
        hasRerankingProvider: false,
        rerankingProviderMessage: rerankerProviderRequired,
      }),
    );
    await waitFor(() =>
      expect(lastDrawerProps).toMatchObject({
        embeddingCatalog: expect.any(Object),
        rerankingCatalog: expect.any(Object),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish create" }));

    expect(screen.getByRole("button", { name: "Select pipeline" })).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toHaveTextContent(
      "Pipeline created with warnings: Chunking may exceed the model limit.",
    );
    await waitFor(() => expect(api.listPipelineVersions).toHaveBeenLastCalledWith("token", "new"));
    await act(async () => {
      await api.listPipelineVersions.mock.results.at(-1)?.value;
    });
  });

  it("blocks reranker preview and drop without an actual reranking connection", async () => {
    const rerankerSpec = makeNodeSpec({
      type: rerankerType,
      label: "Reranker",
      category: "retrieval",
    });
    api.fetchPipelineNodes.mockResolvedValueOnce([rerankerSpec]);
    api.fetchPipelines.mockResolvedValueOnce([
      makePipeline({ kind: "retrieval", definition: { nodes: [], edges: [] } }),
    ]);
    api.listConnections.mockResolvedValueOnce([]);

    render(<PipelineBuilder kind="retrieval" />);

    await waitFor(() => expect(lastSidebarProps).not.toBeNull());
    expect(lastSidebarProps).toMatchObject({ hasRerankingProvider: false });

    act(() => {
      (lastSidebarProps?.onPreviewNode as (spec: NodeSpec) => void)(rerankerSpec);
    });
    expect(lastDrawerProps?.node).toBeNull();

    const dropEvent = buildDragEvent(rerankerType);
    act(() => {
      (lastCanvasProps?.onDrop as (event: unknown) => void)(dropEvent);
    });
    expect(screen.getByTestId("canvas")).toHaveTextContent(/reranking provider/);
  });

  it("blocks reranker insertion while provider connections are still loading", async () => {
    const rerankerSpec = makeNodeSpec({
      type: rerankerType,
      label: "Reranker",
      category: "retrieval",
    });
    api.fetchPipelineNodes.mockResolvedValueOnce([rerankerSpec]);
    api.fetchPipelines.mockResolvedValueOnce([
      makePipeline({ kind: "retrieval", definition: { nodes: [], edges: [] } }),
    ]);
    let resolveConnections: ((connections: []) => void) | undefined;
    api.listConnections.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnections = resolve;
        }),
    );

    render(<PipelineBuilder kind="retrieval" />);

    await waitFor(() => expect(lastSidebarProps).not.toBeNull());
    expect(lastSidebarProps).toMatchObject({
      hasRerankingProvider: false,
      rerankingProviderMessage: rerankerProviderLoading,
    });
    act(() => {
      (lastSidebarProps?.onPreviewNode as (spec: NodeSpec) => void)(rerankerSpec);
    });
    expect(screen.getByTestId("canvas")).toHaveTextContent(rerankerProviderLoading);

    await act(async () => resolveConnections?.([]));
    await waitFor(() =>
      expect(lastSidebarProps).toMatchObject({
        hasRerankingProvider: false,
        rerankingProviderMessage: rerankerProviderRequired,
      }),
    );
  });

  it("blocks reranker insertion and surfaces provider connection errors", async () => {
    const rerankerSpec = makeNodeSpec({
      type: rerankerType,
      label: "Reranker",
      category: "retrieval",
    });
    api.fetchPipelineNodes.mockResolvedValueOnce([rerankerSpec]);
    api.fetchPipelines.mockResolvedValueOnce([
      makePipeline({ kind: "retrieval", definition: { nodes: [], edges: [] } }),
    ]);
    api.listConnections.mockRejectedValueOnce(new Error("Connection request failed."));

    render(<PipelineBuilder kind="retrieval" />);

    await waitFor(() =>
      expect(lastSidebarProps).toMatchObject({
        hasRerankingProvider: false,
        rerankingProviderMessage: rerankerProviderError,
      }),
    );
    act(() => {
      (lastSidebarProps?.onPreviewNode as (spec: NodeSpec) => void)(rerankerSpec);
    });
    expect(screen.getByTestId("canvas")).toHaveTextContent(rerankerProviderError);
  });

  it("handles connect, save, and delete logic", async () => {
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    io.validatePipelineConnection.mockReturnValueOnce({ valid: false, reason: "Invalid" });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByTestId("canvas")).toHaveTextContent("Invalid");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    fireEvent.click(screen.getByRole("button", { name: openSaveLabel }));
    fireEvent.click(screen.getByRole("button", { name: savePipelineLabel }));
    await waitFor(() => expect(api.updatePipeline).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: deletePipelineLabel }));
    fireEvent.click(screen.getByRole("button", { name: confirmDeleteLabel }));
    await waitFor(() => expect(api.deletePipeline).toHaveBeenCalled());
  });

  it("requires consent before saving an uncached HuggingFace tokenizer", async () => {
    const chunkerSpec = makeNodeSpec({
      type: "chunker.token",
      label: "Token Chunker",
      category: "ingestion",
      input_ports: [
        {
          key: "document",
          label: "Document",
          data_type: "document",
          required: true,
          accepts_many: false,
        },
      ],
      output_ports: [
        {
          key: "chunks",
          label: "Chunks",
          data_type: "chunk_batch",
          required: true,
          accepts_many: false,
        },
      ],
    });
    api.fetchPipelines.mockResolvedValueOnce([
      {
        ...pipeline,
        definition: {
          nodes: [
            ...pipeline.definition.nodes,
            {
              id: "chunker",
              type: "chunker.token",
              name: "Token Chunker",
              config: { tokenizer: "huggingface", hf_model_id: hfModelId },
              position: { x: -200, y: 0 },
            },
          ],
          edges: [],
        },
      },
    ]);
    api.fetchPipelineNodes.mockResolvedValueOnce([...nodeSpecs, chunkerSpec]);
    api.ensureHuggingFaceTokenizer
      .mockRejectedValueOnce(new ApiError(400, "Download consent is required."))
      .mockResolvedValue({ model_id: hfModelId, cached: true });
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect((lastCanvasProps?.nodes as unknown[] | undefined)?.length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: openSaveLabel }));
    fireEvent.click(screen.getByRole("button", { name: savePipelineLabel }));

    expect(await screen.findByRole("button", { name: "Download tokenizer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Remember this choice" }));
    fireEvent.click(screen.getByRole("button", { name: "Download tokenizer" }));

    await waitFor(() => expect(api.updatePipeline).toHaveBeenCalled());
    expect(api.ensureHuggingFaceTokenizer).toHaveBeenLastCalledWith("token", {
      model_id: hfModelId,
      consent: true,
      remember: true,
    });
  });

  it("handles delete errors", async () => {
    api.deletePipeline.mockRejectedValueOnce("bad");
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: deletePipelineLabel }));
    fireEvent.click(screen.getByRole("button", { name: confirmDeleteLabel }));

    await waitFor(() => {
      expect(screen.getByTestId("canvas")).toHaveTextContent("Unable to delete pipeline.");
    });
  });

  it("handles validation errors and activation", async () => {
    io.validatePipelineConfig.mockReturnValue({ nodeErrors: { "node-1": ["Missing"] } });
    api.validatePipeline.mockResolvedValueOnce({
      valid: false,
      errors: ["Bad"],
      warnings: [],
      issues: [],
    });

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastDrawerProps).not.toBeNull());
    // Wait for the async pipeline load to land its nodes on the canvas --
    // label edits no-op until the selected node actually exists.
    await waitFor(() =>
      expect((lastCanvasProps?.nodes as unknown[] | undefined)?.length).toBeGreaterThan(0),
    );

    fireEvent.click(screen.getByRole("button", { name: selectNodeLabel }));
    // With node errors present, opening the save dialog is refused with a notice.
    fireEvent.click(screen.getByRole("button", { name: openSaveLabel }));
    await waitFor(() => expect(screen.getByTestId("canvas")).toHaveTextContent("Missing"));
    expect(screen.queryByRole("button", { name: savePipelineLabel })).not.toBeInTheDocument();
    expect(api.validatePipeline).not.toHaveBeenCalled();

    io.validatePipelineConfig.mockReturnValue({ nodeErrors: {} });
    fireEvent.click(screen.getByRole("button", { name: saveNodeEditsLabel }));
    fireEvent.click(screen.getByRole("button", { name: openSaveLabel }));
    fireEvent.click(screen.getByRole("button", { name: savePipelineLabel }));
    await waitFor(() => expect(api.validatePipeline).toHaveBeenCalled());
    // Generous timeout: the failure banner lands a few async hops after the
    // API resolves, which can exceed waitFor's 1s default on slow CI runners.
    await waitFor(
      () => expect(screen.getByTestId("canvas")).toHaveTextContent(/Validation failed/),
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByRole("button", { name: openHistoryLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(api.activatePipelineVersion).toHaveBeenCalled());
  });

  it("keeps the save-version dialog open and surfaces field validation issues", async () => {
    const issue = {
      code: "embedding_input_limit_exceeded",
      message: "Chunk size exceeds the embedding model input limit.",
      severity: "error" as const,
      node_id: "node-1",
      field: "chunk_size",
    };
    api.validatePipeline.mockResolvedValueOnce({
      valid: false,
      errors: [issue.message],
      warnings: [],
      issues: [issue],
    });

    render(<PipelineBuilder kind="ingestion" />);
    await waitFor(() => expect(lastCanvasProps).not.toBeNull());
    await waitFor(() =>
      expect((lastCanvasProps?.nodes as unknown[] | undefined)?.length).toBeGreaterThan(0),
    );

    fireEvent.click(screen.getByRole("button", { name: selectNodeLabel }));
    fireEvent.click(screen.getByRole("button", { name: openSaveLabel }));
    fireEvent.click(screen.getByRole("button", { name: savePipelineLabel }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Validation failed: Chunk size exceeds the embedding model input limit.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "chunk_size: Chunk size exceeds the embedding model input limit.",
    );
    expect(within(dialog).getByRole("button", { name: savePipelineLabel })).toBeInTheDocument();
    expect(api.updatePipeline).not.toHaveBeenCalled();
  });

  it("surfaces validation warnings and save failures", async () => {
    api.validatePipeline.mockResolvedValueOnce({
      valid: true,
      errors: [],
      warnings: ["Be careful"],
      issues: [],
    });
    const returnedIssue = {
      message: "Chunk size is above the selected model limit.",
      severity: "warning" as const,
      node_id: "node-1",
      field: "chunk_size",
    };
    api.updatePipeline.mockResolvedValueOnce({
      ...pipeline,
      validation_issues: [returnedIssue],
    });

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());
    await waitFor(() =>
      expect((lastCanvasProps?.nodes as unknown[] | undefined)?.length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByRole("button", { name: selectNodeLabel }));

    fireEvent.click(screen.getByRole("button", { name: openSaveLabel }));
    fireEvent.click(screen.getByRole("button", { name: savePipelineLabel }));
    await waitFor(() => {
      expect(api.updatePipeline).toHaveBeenCalled();
      expect(screen.getByTestId("canvas")).toHaveTextContent("Saved as v1. Warnings: Be careful");
      expect(lastDrawerProps?.validationIssues).toEqual([returnedIssue]);
    });

    api.validatePipeline.mockResolvedValueOnce({
      valid: true,
      errors: [],
      warnings: [],
      issues: [],
    });
    const staleIssue = {
      message: "Selected model is no longer available.",
      severity: "error" as const,
      node_id: "node-1",
      field: "model_name",
    };
    api.updatePipeline.mockRejectedValueOnce(
      new ApiError(400, staleIssue.message, { errors: [staleIssue.message], issues: [staleIssue] }),
    );

    fireEvent.click(screen.getByRole("button", { name: openSaveLabel }));
    fireEvent.click(screen.getByRole("button", { name: savePipelineLabel }));
    await waitFor(() => {
      expect(screen.getByTestId("canvas")).toHaveTextContent(staleIssue.message);
      expect(
        (lastCanvasProps?.nodes as Array<{ data: { errors?: string[] } }>)[0]?.data.errors,
      ).toContain(staleIssue.message);
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(staleIssue.message);
  });

  it("handles activation errors", async () => {
    api.activatePipelineVersion.mockRejectedValueOnce("boom");

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => {
      expect(lastCanvasProps).not.toBeNull();
      expect(api.listPipelineVersions).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: openHistoryLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => {
      expect(screen.getByTestId("canvas")).toHaveTextContent("Unable to activate version.");
    });
  });

  it("opens index manager and selects embedding models", async () => {
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastDrawerProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Open index manager" }));
    fireEvent.click(screen.getByRole("button", { name: "Close indexes" }));

    fireEvent.click(screen.getByRole("button", { name: selectNodeLabel }));
    fireEvent.click(screen.getByRole("button", { name: saveNodeEditsLabel }));
    expect(lastDrawerProps?.node).toBeDefined();
  });

  it("prevents deletion when pipeline is in use", async () => {
    api.fetchCollections.mockResolvedValueOnce([
      makeCollection({
        name: "Collection",
        ingest_pipeline_id: "pipe-1",
        tools: [
          { id: "binding-1", pipeline_id: "pipe-1", is_primary: true, enabled: true, position: 0 },
        ],
      }),
    ]);

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: deletePipelineLabel }));
    expect(screen.getByTestId("canvas")).toHaveTextContent(/cannot be deleted/);
  });

  it("handles drag previews, index manager return, and embedding selection", async () => {
    const pipelineWithEdge: Pipeline = {
      ...pipeline,
      definition: {
        nodes: [
          ...pipeline.definition.nodes,
          {
            id: "node-2",
            type: embedderType,
            name: "Embed Two",
            config: {},
            position: { x: 120, y: 120 },
          },
        ],
        edges: [
          {
            id: "edge-1",
            source: "node-1",
            target: "node-2",
            source_port: "out",
            target_port: "in",
          },
        ],
        viewport: {},
      },
    };

    api.fetchPipelines.mockResolvedValueOnce([pipelineWithEdge]);
    api.fetchEmbeddingModels.mockResolvedValueOnce({
      models: [
        makeCatalogModel({ id: "emb-1", name: "Alpha", dimension: 512 }),
        makeCatalogModel({ id: "emb-2", name: "Beta", dimension: null }),
      ],
      connection_errors: [],
      meta: { freshness: "fresh", age_seconds: 0, refreshing: false, warning: null },
    });
    io.validatePipelineEdges.mockReturnValue({
      edgeErrors: { "edge-1": "bad edge" },
      nodeErrors: {},
    });

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    await waitFor(() => {
      const edges = lastCanvasProps?.edges as
        | Array<{ id: string; data?: { error?: boolean } }>
        | undefined;
      expect(edges?.some((edge) => edge.data?.error)).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Open indexes from wizard" }));
    expect(screen.getByRole("button", { name: "Refresh indexes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh indexes" }));
    expect(api.listIndexes).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close indexes" }));
    expect(screen.getByRole("button", { name: "Finish create" })).toBeInTheDocument();

    await waitFor(() => {
      const catalog = (lastSidebarProps as { catalog?: { specs?: NodeSpec[] }[] } | null)?.catalog;
      expect(catalog?.[0]?.specs?.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview node" }));
    await waitFor(() => {
      expect((lastDrawerProps as { isPreview?: boolean }).isPreview).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: selectNodeLabel }));
    await waitFor(() => {
      expect((lastDrawerProps as { node?: unknown }).node).toBeDefined();
    });

    const selectedNodeConfig = () =>
      (lastDrawerProps as { node?: { data?: { config?: Record<string, unknown> } } }).node?.data
        ?.config ?? {};

    fireEvent.click(screen.getByRole("button", { name: saveNodeEditsLabel }));
    await waitFor(() => {
      expect(selectedNodeConfig().model_name).toBe("emb-1");
    });

    const emptyDragEvent = buildDragEvent("");
    act(() => {
      (lastCanvasProps as { onDragOver?: (event: unknown) => void }).onDragOver?.(emptyDragEvent);
    });

    const unknownDropEvent = buildDragEvent("unknown");
    act(() => {
      (lastCanvasProps as { onDrop?: (event: unknown) => void }).onDrop?.(unknownDropEvent);
    });
    expect(screen.getByTestId("canvas")).toHaveTextContent(/unknown type/);

    const validDragEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: (key: string) => (key === "application/ragworks-node" ? embedderType : ""),
        dropEffect: "",
      },
      clientX: 10,
      clientY: 20,
    };

    act(() => {
      (lastCanvasProps as { onDragOver?: (event: unknown) => void }).onDragOver?.(validDragEvent);
    });

    act(() => {
      (lastCanvasProps as { onDrop?: (event: unknown) => void }).onDrop?.(validDragEvent);
    });

    act(() => {
      (lastCanvasProps as { onInit?: (instance: unknown) => void }).onInit?.({
        screenToFlowPosition: (point: { x: number; y: number }) => point,
      });
    });

    act(() => {
      (lastCanvasProps as { onDragOver?: (event: unknown) => void }).onDragOver?.(validDragEvent);
    });

    await waitFor(() => {
      const nodes = lastCanvasProps?.nodes as Array<{ id: string }> | undefined;
      expect(nodes?.some((node) => node.id === "drop-preview")).toBe(true);
    });

    act(() => {
      (lastCanvasProps as { onDrop?: (event: unknown) => void }).onDrop?.(validDragEvent);
    });

    act(() => {
      (lastCanvasProps as { onDragLeave?: () => void }).onDragLeave?.();
    });

    act(() => {
      (lastCanvasProps as { onDrop?: (event: unknown) => void }).onDrop?.(validDragEvent);
    });

    act(() => {
      (lastCanvasProps as { onInit?: (instance: unknown) => void }).onInit?.({
        project: (point: { x: number; y: number }) => ({ x: point.x + 1, y: point.y + 1 }),
      });
    });

    act(() => {
      (lastCanvasProps as { onDragOver?: (event: unknown) => void }).onDragOver?.(validDragEvent);
    });

    act(() => {
      (lastCanvasProps as { onDragLeave?: () => void }).onDragLeave?.();
    });

    act(() => {
      (lastCanvasProps as { onDrop?: (event: unknown) => void }).onDrop?.(validDragEvent);
    });

    await waitFor(() => {
      const nodes = lastCanvasProps?.nodes as Array<{ id: string }> | undefined;
      expect(nodes?.some((node) => node.id === "drop-preview")).toBe(false);
    });

    act(() => {
      (lastCanvasProps as { onDragLeave?: () => void }).onDragLeave?.();
    });
  });
});
