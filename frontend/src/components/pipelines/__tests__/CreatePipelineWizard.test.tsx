import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePipelineWizard } from "@/components/pipelines/CreatePipelineWizard";
import * as apiModule from "@/lib/api";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import {
  makeBackendInfo,
  makeCatalogModel,
  makeModelCatalog,
  makeNodeSpec,
  makePineconeBackendInfo,
  makePipeline,
  makeVectorIndex,
} from "@/test/fixtures";

import type { VectorIndex } from "@/lib/types";
import type { ComponentProps } from "react";

const pipelineUtils = {
  buildDefaultDefinition: vi.fn(),
};
const flowPlayerSpy = vi.fn();
const createPipelineLabel = "Create pipeline";
const getNextButton = () => screen.getByRole("button", { name: "Next" });
const EMBEDDING_SELECTOR_TEST_ID = "embedding-selector";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/components/pipelines/lib/pipeline-scaffold", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildDefaultDefinition: (...args: unknown[]) => pipelineUtils.buildDefaultDefinition(...args),
}));
vi.mock("@/components/pipelines/lib/pipeline-utils", () => ({
  sortIndexesByName: (indexes: { name: string }[]) =>
    [...indexes].sort((a, b) => a.name.localeCompare(b.name)),
  toFlowNodes: () => [],
  toFlowEdges: () => [],
}));
vi.mock("@/components/pipelines/flow/FlowPlayer", () => ({
  FlowPlayer: (props: object) => {
    flowPlayerSpy(props);
    return <div data-testid="flow-player" />;
  },
}));
vi.mock("@/lib/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: vi.fn(() => false),
}));
vi.mock("@/components/pipelines/EmbeddingModelSelectorCard", () => ({
  EmbeddingModelSelectorCard: ({
    models,
    onSelectModel,
  }: {
    models: ReturnType<typeof makeCatalogModel>[];
    onSelectModel: (model: ReturnType<typeof makeCatalogModel>) => void;
  }) => (
    <button
      type="button"
      data-testid={EMBEDDING_SELECTOR_TEST_ID}
      onClick={() => onSelectModel(models[0])}
    >
      pick model
    </button>
  ),
}));

const api = vi.mocked(apiModule);
const prefersReducedMotion = vi.mocked(usePrefersReducedMotion);

type WizardProps = ComponentProps<typeof CreatePipelineWizard>;

function makeWizardProps(overrides: Partial<WizardProps> = {}): WizardProps {
  const embeddingModel = makeCatalogModel({ id: "emb-1", name: "Embed" });
  return {
    open: true,
    token: "token",
    kind: "ingestion",
    indexes: [],
    backends: [makeBackendInfo(), makePineconeBackendInfo()],
    nodeSpecs: [],
    embeddingModels: [embeddingModel],
    embeddingCatalog: makeModelCatalog([embeddingModel]),
    embeddingModelsLoading: false,
    embeddingModelsError: null,
    onClose: () => undefined,
    onCreated: () => undefined,
    onOpenIndexManager: () => undefined,
    ...overrides,
  };
}

function renderWizard(overrides: Partial<WizardProps> = {}) {
  return render(<CreatePipelineWizard {...makeWizardProps(overrides)} />);
}

async function chooseIndex(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: new RegExp(name, "i") }));
}

describe("CreatePipelineWizard", () => {
  const pipeline = makePipeline({ kind: "ingestion", definition: { nodes: [], edges: [] } });

  beforeEach(() => {
    flowPlayerSpy.mockClear();
    prefersReducedMotion.mockReturnValue(false);
    pipelineUtils.buildDefaultDefinition.mockReturnValue({ nodes: [], edges: [] });
  });

  it("renders nothing when closed", () => {
    const { container } = renderWizard({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("revalidates the model catalog when the selector flow becomes visible", () => {
    const onCatalogVisible = vi.fn();
    const props = makeWizardProps({ open: false, onCatalogVisible });
    const { rerender } = render(<CreatePipelineWizard {...props} />);

    expect(onCatalogVisible).not.toHaveBeenCalled();
    rerender(<CreatePipelineWizard {...props} open />);

    expect(onCatalogVisible).toHaveBeenCalledTimes(1);
  });

  it("handles step navigation and index creation prompt", async () => {
    const user = userEvent.setup();
    const onOpenIndexManager = vi.fn();
    renderWizard({ onOpenIndexManager });

    expect(getNextButton()).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Research library/), "New");
    expect(getNextButton()).toBeEnabled();

    await user.click(getNextButton());
    expect(screen.getByText(/Select an index/)).toBeInTheDocument();
    expect(getNextButton()).toBeDisabled();
    expect(screen.getByText(/No pgvector \(PostgreSQL\) indexes/)).toBeInTheDocument();

    const indexSelector = screen.getByRole("combobox", { name: /pgvector.*index/i });
    await user.click(indexSelector);
    expect(indexSelector).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Add new index/ }));
    expect(onOpenIndexManager).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Create index/ }));
    expect(onOpenIndexManager).toHaveBeenCalledTimes(2);
  }, 10000);

  it("requires an index selection before proceeding", async () => {
    const user = userEvent.setup();
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })] });

    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(getNextButton());

    expect(getNextButton()).toBeDisabled();

    await chooseIndex(user, "alpha");
    expect(getNextButton()).toBeEnabled();
  });

  it("closes only the index popup on Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha" })], onClose });

    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("creates a pipeline with the selected options and handles errors", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const indexes: VectorIndex[] = [makeVectorIndex({ name: "alpha", dimension: 768 })];

    api.createPipeline.mockResolvedValueOnce(pipeline);

    renderWizard({ kind: "retrieval", indexes, onClose, onCreated });

    // Template step: the default (semantic + keyword) is preselected.
    expect(screen.getByRole("radio", { name: /Semantic \+ keyword/ })).toBeChecked();
    await user.click(getNextButton());

    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(getNextButton());

    await chooseIndex(user, "alpha");
    await user.click(getNextButton());

    // Embedding step for semantic retrieval pipelines.
    expect(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID)).toBeInTheDocument();
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());

    // Review step renders the animated preview + summary.
    expect(screen.getByTestId("flow-player")).toBeInTheDocument();
    expect(screen.getByText("Pipe")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      // Semantic-keyword template builds via the hybrid retrieval scaffold —
      // no chunk options (those belong to ingestion).
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith("retrieval", "pgvector", {
        indexName: "alpha",
        indexDimension: 768,
        embeddingConnectionId: "conn-openrouter-1",
        embeddingModel: "emb-1",
        includeBm25: true,
        indexNameMaxLength: 45,
      });
      expect(onCreated).toHaveBeenCalledWith(pipeline);
      expect(onClose).toHaveBeenCalled();
    });

    api.createPipeline.mockRejectedValueOnce(new Error("Boom"));
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));
    expect(await screen.findByText("Boom")).toBeInTheDocument();

    api.createPipeline.mockRejectedValueOnce("bad");
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));
    expect(await screen.findByText("Unable to create pipeline.")).toBeInTheDocument();
  }, 15000);

  it("derives initial chunking values from the backend node catalog", async () => {
    const user = userEvent.setup();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({
      indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })],
      nodeSpecs: [
        makeNodeSpec({
          type: "chunker.token",
          default_config: { chunk_size: 384, chunk_overlap: 48 },
        }),
      ],
    });

    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(getNextButton());
    await chooseIndex(user, "alpha");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() =>
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith(
        "ingestion",
        "pgvector",
        expect.objectContaining({ chunkSize: 384, chunkOverlap: 48 }),
      ),
    );
  });

  it("applies chunking presets on the processing step", async () => {
    const user = userEvent.setup();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: null })] });

    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(getNextButton());
    await chooseIndex(user, "alpha");
    await user.click(getNextButton());

    await user.click(screen.getByRole("radio", { name: /Fine/ }));
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith("ingestion", "pgvector", {
        indexName: "alpha",
        indexDimension: undefined,
        embeddingConnectionId: "conn-openrouter-1",
        embeddingModel: "emb-1",
        chunkSize: 512,
        chunkOverlap: 64,
        includeBm25: true,
        indexNameMaxLength: 45,
      });
    });
  }, 15000);

  it("blocks creation when a refresh removes the selected connection-model pair", async () => {
    const user = userEvent.setup();
    const selected = makeCatalogModel({
      connection_id: "conn-a",
      id: "shared-model",
      name: "Selected model",
    });
    const props = makeWizardProps({
      kind: "retrieval",
      indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })],
      embeddingModels: [selected],
      embeddingCatalog: makeModelCatalog([selected]),
    });
    const { rerender } = render(<CreatePipelineWizard {...props} />);

    await user.click(getNextButton()); // template step (semantic default)
    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(getNextButton());
    await chooseIndex(user, "alpha");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());
    expect(screen.getByRole("button", { name: createPipelineLabel })).toBeEnabled();

    rerender(
      <CreatePipelineWizard
        {...props}
        embeddingModels={[]}
        embeddingCatalog={makeModelCatalog([], [], {
          freshness: "stale",
          age_seconds: 20,
          refreshing: true,
          warning: null,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: createPipelineLabel })).toBeEnabled();
    expect(screen.getByText("shared-model")).toBeInTheDocument();

    rerender(
      <CreatePipelineWizard
        {...props}
        embeddingModels={[]}
        embeddingCatalog={makeModelCatalog([])}
      />,
    );

    expect(screen.getByRole("button", { name: createPipelineLabel })).toBeDisabled();
    expect(screen.getByText("shared-model (Unavailable)")).toBeInTheDocument();
  });

  it("shows summary defaults when details are missing", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole("button", { name: /Review/ }));

    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText(/no index/)).toBeInTheDocument();
    expect(screen.getByText("Workspace default")).toBeInTheDocument();
  });

  it("previews the hybrid scaffold in topology order instead of serialized node order", async () => {
    const user = userEvent.setup();
    pipelineUtils.buildDefaultDefinition.mockReturnValue({
      nodes: ["input", "semantic", "output", "lexical"].map((id) => ({
        id,
        type: `test.${id}`,
        name: id,
        config: {},
      })),
      edges: [
        { id: "input-semantic", source: "input", target: "semantic" },
        { id: "input-lexical", source: "input", target: "lexical" },
        { id: "semantic-output", source: "semantic", target: "output" },
        { id: "lexical-output", source: "lexical", target: "output" },
      ],
    });
    renderWizard();

    await user.click(screen.getByRole("button", { name: /Review/ }));

    expect(flowPlayerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        steps: [
          { nodeIds: ["input"] },
          { nodeIds: ["lexical", "semantic"] },
          { nodeIds: ["output"] },
        ],
      }),
    );
  });

  it("renders the review graph without autoplay under reduced motion", async () => {
    const user = userEvent.setup();
    prefersReducedMotion.mockReturnValue(true);
    renderWizard();

    await user.click(screen.getByRole("button", { name: /Review/ }));

    expect(flowPlayerSpy).toHaveBeenLastCalledWith(expect.objectContaining({ autoPlay: false }));
  });

  it("skips the embedding step for the count template and creates without a model", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({
      kind: "retrieval",
      indexes: [makeVectorIndex({ name: "alpha", backend: "pgvector" })],
      onCreated,
    });

    await user.click(screen.getByRole("radio", { name: /Count matches/ }));
    await user.click(getNextButton());
    await user.type(screen.getByPlaceholderText(/Research library/), "Counter");
    await user.click(getNextButton());
    await chooseIndex(user, "alpha");
    await user.click(getNextButton());

    // No embedding step — count doesn't embed. Straight to review + create.
    expect(screen.queryByTestId(EMBEDDING_SELECTOR_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByText("Count matches")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      const definition = api.createPipeline.mock.calls[0][1].definition;
      expect(definition.nodes.map((node: { type: string }) => node.type)).toEqual([
        "retrieval.input",
        "count.bm25",
        "tool.output",
      ]);
      expect(onCreated).toHaveBeenCalled();
    });
  }, 15000);

  it("skips store and embedding for the blank template, creating an input-only graph", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({ kind: "retrieval", onCreated });

    await user.click(screen.getByRole("radio", { name: /Blank pipeline/ }));
    await user.click(getNextButton());
    await user.type(screen.getByPlaceholderText(/Research library/), "Scratch");
    // No store step and no embedding step — straight from name to review.
    await user.click(getNextButton());

    expect(screen.queryByTestId(EMBEDDING_SELECTOR_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByText("Blank pipeline")).toBeInTheDocument();
    // The blank scaffold declares no vector store.
    expect(screen.queryByText(/no index/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      const definition = api.createPipeline.mock.calls[0][1].definition;
      expect(definition.nodes.map((node: { type: string }) => node.type)).toEqual([
        "retrieval.input",
      ]);
      expect(definition.edges).toEqual([]);
      expect(onCreated).toHaveBeenCalled();
    });
  }, 15000);

  it("blocks the count template on a backend without count support", async () => {
    const user = userEvent.setup();
    renderWizard({
      kind: "retrieval",
      backends: [makeBackendInfo(), makePineconeBackendInfo()],
      indexes: [makeVectorIndex({ name: "cloud", backend: "pinecone" })],
    });

    await user.click(screen.getByRole("radio", { name: /Count matches/ }));
    await user.click(getNextButton());
    await user.type(screen.getByPlaceholderText(/Research library/), "Counter");
    await user.click(getNextButton());

    // Pinecone can't run count — selecting it warns and blocks proceeding.
    await user.click(screen.getByRole("button", { name: /Pinecone/ }));
    expect(screen.getByRole("status")).toHaveTextContent(/can't run "Count matches"/);
    expect(getNextButton()).toBeDisabled();
  }, 15000);
});

describe("CreatePipelineWizard backend selection", () => {
  beforeEach(() => {
    pipelineUtils.buildDefaultDefinition.mockReturnValue({ nodes: [], edges: [] });
  });

  async function renderStoreStep(overrides?: { pineconeConfigured?: boolean }) {
    const user = userEvent.setup();
    const backends = [
      makeBackendInfo(),
      makePineconeBackendInfo({ configured: overrides?.pineconeConfigured ?? true }),
    ];
    const indexes = [
      makeVectorIndex({ name: "local-docs", backend: "pgvector" }),
      makeVectorIndex({ name: "cloud-docs", backend: "pinecone" }),
    ];
    renderWizard({ backends, indexes });
    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(getNextButton());
    return user;
  }

  it("preselects pgvector and scopes index options to the chosen backend", async () => {
    const user = await renderStoreStep();

    const pgvectorCard = screen.getByRole("button", { name: /pgvector/ });
    expect(pgvectorCard).toHaveAttribute("aria-pressed", "true");
    const indexSelector = screen.getByRole("combobox");
    await user.click(indexSelector);
    expect(screen.getByRole("option", { name: /local-docs/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /cloud-docs/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /Pinecone/ }));
    await user.click(indexSelector);
    expect(screen.getByRole("option", { name: /cloud-docs/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /local-docs/ })).not.toBeInTheDocument();
  });

  it("disables the Pinecone card when no API key is configured", async () => {
    await renderStoreStep({ pineconeConfigured: false });

    expect(screen.getByRole("button", { name: /Pinecone/ })).toBeDisabled();
    expect(screen.getByText(/API key required/)).toBeInTheDocument();
  });
});
