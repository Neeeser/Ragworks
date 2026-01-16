import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineBuilder } from "@/components/pipelines/PipelineBuilder";

import type { NodeSpec, Pipeline, PipelineVersion } from "@/lib/types";
import type { Connection, Edge, Node } from "@xyflow/react";

const api = {
  activatePipelineVersion: vi.fn(),
  deletePipeline: vi.fn(),
  fetchCollections: vi.fn(),
  fetchPipelineNodes: vi.fn(),
  fetchPipelines: vi.fn(),
  fetchEmbeddingModels: vi.fn(),
  listPineconeIndexes: vi.fn(),
  listPipelineVersions: vi.fn(),
  updatePipeline: vi.fn(),
  validatePipeline: vi.fn(),
};

const io = {
  validatePipelineConnection: vi.fn(),
  validatePipelineEdges: vi.fn(),
  validatePipelineConfig: vi.fn(),
};

let lastCanvasProps: Record<string, unknown> | null = null;
let lastInspectorProps: Record<string, unknown> | null = null;
let lastSidebarProps: Record<string, unknown> | null = null;
const baseTimestamp = "2024-01-01T00:00:00.000Z";
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

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ token: "token" }),
}));

vi.mock("@/lib/api", () => ({
  activatePipelineVersion: (...args: unknown[]) => api.activatePipelineVersion(...args),
  deletePipeline: (...args: unknown[]) => api.deletePipeline(...args),
  fetchCollections: (...args: unknown[]) => api.fetchCollections(...args),
  fetchPipelineNodes: (...args: unknown[]) => api.fetchPipelineNodes(...args),
  fetchPipelines: (...args: unknown[]) => api.fetchPipelines(...args),
  fetchEmbeddingModels: (...args: unknown[]) => api.fetchEmbeddingModels(...args),
  listPineconeIndexes: (...args: unknown[]) => api.listPineconeIndexes(...args),
  listPipelineVersions: (...args: unknown[]) => api.listPipelineVersions(...args),
  updatePipeline: (...args: unknown[]) => api.updatePipeline(...args),
  validatePipeline: (...args: unknown[]) => api.validatePipeline(...args),
}));

vi.mock("@/components/pipelines/pipeline-io", () => ({
  validatePipelineConnection: (...args: unknown[]) => io.validatePipelineConnection(...args),
  validatePipelineEdges: (...args: unknown[]) => io.validatePipelineEdges(...args),
  validatePipelineConfig: (...args: unknown[]) => io.validatePipelineConfig(...args),
}));

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");
  return {
    addEdge: (edge: Edge, edges: Edge[]) => [...edges, edge],
    useNodesState: <T,>(initial: Node<T>[]) => {
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

vi.mock("@/components/pipelines/PipelineInspector", () => ({
  PipelineInspector: (props: Record<string, unknown>) => {
    lastInspectorProps = props;
    return (
      <div>
        <button type="button" onClick={() => (props.onApplyConfig as () => void)?.()}>
          Apply config
        </button>
        <button
          type="button"
          onClick={() => (props.onOpenIndexManager as (flag?: boolean) => void)?.(true)}
        >
          Open index manager
        </button>
        <button
          type="button"
          onClick={() => (props.onSelectEmbeddingModel as (id: string) => void)?.("emb-1")}
        >
          Select embedding
        </button>
        <button
          type="button"
          onClick={() => (props.onLabelChange as (value: string) => void)?.("Label")}
        >
          Change label
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/pipelines/PipelineSavePanel", () => ({
  PipelineSavePanel: ({ onSave }: { onSave: () => void }) => (
    <button type="button" onClick={onSave}>
      Save pipeline
    </button>
  ),
}));

vi.mock("@/components/pipelines/PipelineRevisions", () => ({
  PipelineRevisions: ({
    onActivate,
    versions,
  }: {
    onActivate: (version: PipelineVersion) => void;
    versions: PipelineVersion[];
  }) => (
    <button type="button" onClick={() => onActivate(versions[0])}>
      Activate
    </button>
  ),
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
  }: {
    onCreatePipeline: () => void;
    onManageIndexes: () => void;
  }) => (
    <div>
      <button type="button" onClick={onCreatePipeline}>
        Create pipeline
      </button>
      <button type="button" onClick={onManageIndexes}>
        Manage indexes
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
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onConfirm}>
          Confirm delete
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

const pipeline: Pipeline = {
  id: "pipe-1",
  user_id: "user-1",
  name: "Pipeline",
  kind: "ingestion",
  current_version: 1,
  is_default: false,
  created_at: baseTimestamp,
  updated_at: baseTimestamp,
  definition: {
    nodes: [
      {
        id: "node-1",
        type: "embedder.openrouter",
        name: "Embed",
        config: {},
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    viewport: {},
  },
};

const nodeSpecs: NodeSpec[] = [
  {
    type: "embedder.openrouter",
    label: "Embedder",
    category: "ingestion",
    description: "",
    example: "",
    input_ports: [],
    output_ports: [],
    config_schema: {},
    default_config: {},
  },
];

describe("PipelineBuilder", () => {
  beforeEach(() => {
    lastCanvasProps = null;
    lastInspectorProps = null;
    lastSidebarProps = null;
    api.fetchPipelines.mockResolvedValue([pipeline]);
    api.fetchPipelineNodes.mockResolvedValue(nodeSpecs);
    api.fetchCollections.mockResolvedValue([]);
    api.fetchEmbeddingModels.mockResolvedValue([]);
    api.listPineconeIndexes.mockResolvedValue([]);
    api.listPipelineVersions.mockResolvedValue([
      {
        id: "v1",
        pipeline_id: "pipe-1",
        version: 1,
        created_at: baseTimestamp,
        updated_at: baseTimestamp,
      },
    ]);
    api.validatePipeline.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    api.updatePipeline.mockResolvedValue(pipeline);
    api.deletePipeline.mockResolvedValue(undefined);
    api.activatePipelineVersion.mockResolvedValue(pipeline);

    io.validatePipelineConnection.mockReturnValue({ valid: true });
    io.validatePipelineEdges.mockReturnValue({ edgeErrors: {}, nodeErrors: {} });
    io.validatePipelineConfig.mockReturnValue({ nodeErrors: {} });
  });

  it("loads pipelines and handles create flow", async () => {
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => {
      expect(api.fetchPipelines).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish create" }));

    expect(screen.getByRole("button", { name: "Select pipeline" })).toBeInTheDocument();
  });

  it("handles connect, save, and delete logic", async () => {
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    io.validatePipelineConnection.mockReturnValueOnce({ valid: false, reason: "Invalid" });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByTestId("canvas")).toHaveTextContent("Invalid");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    fireEvent.click(screen.getByRole("button", { name: "Save pipeline" }));
    await waitFor(() => expect(api.updatePipeline).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Delete pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(api.deletePipeline).toHaveBeenCalled());
  });

  it("handles delete errors", async () => {
    api.deletePipeline.mockRejectedValueOnce("bad");
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Delete pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(screen.getByTestId("canvas")).toHaveTextContent("Unable to delete pipeline.");
    });
  });

  it("handles validation errors and activation", async () => {
    io.validatePipelineConfig.mockReturnValue({ nodeErrors: { "node-1": ["Missing"] } });
    api.validatePipeline.mockResolvedValueOnce({ valid: false, errors: ["Bad"], warnings: [] });

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastInspectorProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Select node" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply config" }));
    expect(screen.getByTestId("canvas")).toHaveTextContent("Missing");

    io.validatePipelineConfig.mockReturnValue({ nodeErrors: {} });
    fireEvent.click(screen.getByRole("button", { name: "Change label" }));
    fireEvent.click(screen.getByRole("button", { name: "Save pipeline" }));
    await waitFor(() => {
      expect(api.validatePipeline).toHaveBeenCalled();
      expect(screen.getByTestId("canvas")).toHaveTextContent(/Validation failed/);
    });

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(api.activatePipelineVersion).toHaveBeenCalled());
  });

  it("surfaces validation warnings and save failures", async () => {
    api.validatePipeline.mockResolvedValueOnce({
      valid: true,
      errors: [],
      warnings: ["Be careful"],
    });
    api.updatePipeline.mockResolvedValueOnce(pipeline);

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Save pipeline" }));
    await waitFor(() => {
      expect(api.updatePipeline).toHaveBeenCalled();
      expect(screen.getByTestId("canvas")).toHaveTextContent(
        "Pipeline saved as a new version. Warnings: Be careful",
      );
    });

    api.validatePipeline.mockResolvedValueOnce({ valid: true, errors: [], warnings: [] });
    api.updatePipeline.mockRejectedValueOnce("Save failed");

    fireEvent.click(screen.getByRole("button", { name: "Save pipeline" }));
    await waitFor(() => {
      expect(screen.getByTestId("canvas")).toHaveTextContent("Unable to save pipeline.");
    });
  });

  it("handles activation errors", async () => {
    api.activatePipelineVersion.mockRejectedValueOnce("boom");

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => {
      expect(lastCanvasProps).not.toBeNull();
      expect(api.listPipelineVersions).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => {
      expect(screen.getByTestId("canvas")).toHaveTextContent("Unable to activate version.");
    });
  });

  it("opens index manager and selects embedding models", async () => {
    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastInspectorProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Open index manager" }));
    fireEvent.click(screen.getByRole("button", { name: "Close indexes" }));

    fireEvent.click(screen.getByRole("button", { name: "Select embedding" }));
    expect(lastInspectorProps?.selectedNode).toBeDefined();
  });

  it("prevents deletion when pipeline is in use", async () => {
    api.fetchCollections.mockResolvedValueOnce([
      {
        id: "col-1",
        user_id: "user-1",
        name: "Collection",
        created_at: baseTimestamp,
        updated_at: baseTimestamp,
        ingestion_pipeline_id: "pipe-1",
        retrieval_pipeline_id: "pipe-1",
      },
    ]);

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Delete pipeline" }));
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
            type: "embedder.openrouter",
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
    api.fetchEmbeddingModels.mockResolvedValueOnce([
      { id: "emb-1", name: "Alpha", dimension: 512 },
      { id: "emb-2", name: "Beta" },
    ]);
    io.validatePipelineEdges.mockReturnValue({
      edgeErrors: { "edge-1": "bad edge" },
      nodeErrors: {},
    });

    render(<PipelineBuilder kind="ingestion" />);

    await waitFor(() => expect(lastCanvasProps).not.toBeNull());

    await waitFor(() => {
      const edges = lastCanvasProps?.edges as Array<{ id: string; className?: string }> | undefined;
      expect(edges?.some((edge) => edge.className?.includes("pipeline-edge-error"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Open indexes from wizard" }));
    expect(screen.getByRole("button", { name: "Refresh indexes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh indexes" }));
    expect(api.listPineconeIndexes).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close indexes" }));
    expect(screen.getByRole("button", { name: "Finish create" })).toBeInTheDocument();

    await waitFor(() => {
      const catalog = (lastSidebarProps as { catalog?: { specs?: NodeSpec[] }[] } | null)?.catalog;
      expect(catalog?.[0]?.specs?.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview node" }));
    await waitFor(() => {
      expect((lastInspectorProps as { isPreview?: boolean }).isPreview).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Select node" }));
    await waitFor(() => {
      expect((lastInspectorProps as { selectedNode?: unknown }).selectedNode).toBeDefined();
    });

    act(() => {
      (
        lastInspectorProps as { onEmbeddingSearchChange?: (value: string) => void }
      ).onEmbeddingSearchChange?.("alpha");
      (
        lastInspectorProps as { onEmbeddingModelSortChange?: (value: string) => void }
      ).onEmbeddingModelSortChange?.("dimension");
    });

    act(() => {
      (
        lastInspectorProps as { onSelectEmbeddingModel?: (value: string) => void }
      ).onSelectEmbeddingModel?.("emb-1");
    });
    await waitFor(() => {
      expect(
        (lastInspectorProps as { configDraft?: Record<string, unknown> }).configDraft?.dimension,
      ).toBe(512);
    });

    act(() => {
      (
        lastInspectorProps as { onSelectEmbeddingModel?: (value: string) => void }
      ).onSelectEmbeddingModel?.("emb-2");
    });
    await waitFor(() => {
      expect(
        (lastInspectorProps as { configDraft?: Record<string, unknown> }).configDraft?.dimension,
      ).toBeUndefined();
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
        getData: (key: string) =>
          key === "application/transparentrag-node" ? "embedder.openrouter" : "",
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
