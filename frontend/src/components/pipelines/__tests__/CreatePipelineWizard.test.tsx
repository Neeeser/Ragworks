import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePipelineWizard } from "@/components/pipelines/CreatePipelineWizard";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { defaultIndexName } from "@/lib/default-index-name";
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
import { USER_EMAIL, USER_ID } from "@/test/fixtures/constants";

import type { VectorIndex } from "@/lib/types";
import type { ComponentProps } from "react";

const pipelineUtils = {
  buildIngestionDefinition: vi.fn(),
};
const flowPlayerSpy = vi.fn();
const createPipelineLabel = "Create pipeline";
const getNextButton = () => screen.getByRole("button", { name: "Next" });
const EMBEDDING_SELECTOR_TEST_ID = "embedding-selector";
const RERANKING_SELECTOR_TEST_ID = "reranking-selector";
const VISION_SELECTOR_TEST_ID = "vision-selector";
const DESCRIBED_INTAKE = /Text \+ described images/;
const CREATE_ERROR = "Index is full";
const OPENROUTER_CONNECTION = "conn-openrouter-1";
const BM25_INDEX = "alpha-bm25";
const INGESTION_MODEL_ID = "wrote-the-index";
const MISSING_INPUT_ERROR = "Node 'rerank-results' missing inbound edges for: items.";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/components/pipelines/lib/pipeline-scaffold", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildIngestionDefinition: (...args: unknown[]) => pipelineUtils.buildIngestionDefinition(...args),
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
vi.mock("@/components/pipelines/RerankingModelSelectorCard", () => ({
  RerankingModelSelectorCard: ({
    models,
    onSelectModel,
  }: {
    models: ReturnType<typeof makeCatalogModel>[];
    onSelectModel: (model: ReturnType<typeof makeCatalogModel>) => void;
  }) => (
    <button
      type="button"
      data-testid={RERANKING_SELECTOR_TEST_ID}
      onClick={() => onSelectModel(models[0])}
    >
      pick reranker
    </button>
  ),
}));
vi.mock("@/components/pipelines/LlmModelSelectorCard", () => ({
  LlmModelSelectorCard: ({
    models,
    onSelectModel,
  }: {
    models: ReturnType<typeof makeCatalogModel>[];
    onSelectModel: (model: ReturnType<typeof makeCatalogModel>) => void;
  }) => (
    <button
      type="button"
      data-testid={VISION_SELECTOR_TEST_ID}
      onClick={() => onSelectModel(models[0])}
    >
      pick vision model
    </button>
  ),
}));
vi.mock("@/components/pipelines/EmbeddingModelSelectorCard", () => ({
  EmbeddingModelSelectorCard: ({
    models,
    selectedModelKey,
    onSelectModel,
    annotate,
  }: {
    models: ReturnType<typeof makeCatalogModel>[];
    selectedModelKey: string;
    onSelectModel: (model: ReturnType<typeof makeCatalogModel>) => void;
    annotate?: (model: ReturnType<typeof makeCatalogModel>) => {
      badge?: React.ReactNode;
      note?: React.ReactNode;
    } | null;
  }) => (
    <div>
      <button
        type="button"
        data-testid={EMBEDDING_SELECTOR_TEST_ID}
        onClick={() => onSelectModel(models[0])}
      >
        pick model
      </button>
      <button
        type="button"
        data-testid="embedding-selector-second"
        onClick={() => onSelectModel(models[1] ?? models[0])}
      >
        pick second model
      </button>
      <span data-testid="embedding-selected">{selectedModelKey}</span>
      <ul>
        {models.map((model) => (
          <li key={`${model.connection_id}:${model.id}`}>
            {model.id}
            {annotate?.(model)?.badge}
            {annotate?.(model)?.note}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

const api = vi.mocked(apiModule);
const prefersReducedMotion = vi.mocked(usePrefersReducedMotion);

type WizardProps = ComponentProps<typeof CreatePipelineWizard>;

function makeWizardProps(overrides: Partial<WizardProps> = {}): WizardProps {
  const embeddingModel = makeCatalogModel({ id: "emb-1", name: "Embed" });
  const rerankingModel = makeCatalogModel({ id: "rerank-1", name: "Rerank" });
  const visionModel = makeCatalogModel({
    id: "vision-1",
    name: "Vision",
    input_modalities: ["text", "image"],
  });
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
    reranking: {
      models: [rerankingModel],
      catalog: makeModelCatalog([rerankingModel]),
      loading: false,
      error: null,
      onVisible: () => undefined,
      onRetry: () => undefined,
    },
    vision: {
      models: [visionModel],
      catalog: makeModelCatalog([visionModel]),
      loading: false,
      error: null,
      onVisible: () => undefined,
      onRetry: () => undefined,
    },
    onClose: () => undefined,
    onCreated: () => undefined,
    onOpenIndexRegistry: () => undefined,
    ...overrides,
  };
}

function renderWizard(overrides: Partial<WizardProps> = {}) {
  return render(<CreatePipelineWizard {...makeWizardProps(overrides)} />);
}

async function nameIt(user: ReturnType<typeof userEvent.setup>, value: string) {
  const field = screen.getByPlaceholderText(/Research library/);
  await user.clear(field);
  await user.type(field, value);
}

async function chooseIndex(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: new RegExp(name, "i") }));
}

/** The ingestion order: name, then processing, then the store it fills. */
async function toStoreStep(user: ReturnType<typeof userEvent.setup>, name = "Pipe") {
  await nameIt(user, name);
  await user.click(getNextButton());
  await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
  await user.click(getNextButton());
}

/** Switch the store step off its suggested new index onto an existing one. */
async function useExistingIndex(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("radio", { name: /Existing index/ }));
  await chooseIndex(user, name);
}

describe("CreatePipelineWizard", () => {
  const pipeline = makePipeline({ kind: "ingestion", definition: { nodes: [], edges: [] } });

  beforeEach(() => {
    flowPlayerSpy.mockClear();
    prefersReducedMotion.mockReturnValue(false);
    pipelineUtils.buildIngestionDefinition.mockReturnValue({ nodes: [], edges: [] });
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
    const onOpenIndexRegistry = vi.fn();
    renderWizard({ onOpenIndexRegistry });

    expect(getNextButton()).toBeDisabled();

    await nameIt(user, "New");
    expect(getNextButton()).toBeEnabled();

    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());

    // The store step opens on the suggested new index; an account with no
    // index of its own still has somewhere to put its vectors.
    expect(screen.getByRole("radio", { name: /New index/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /Existing index/ }));
    expect(screen.getByText(/Select an index/)).toBeInTheDocument();
    expect(getNextButton()).toBeDisabled();
    expect(screen.getByText(/No pgvector \(PostgreSQL\) indexes/)).toBeInTheDocument();

    const indexSelector = screen.getByRole("combobox", { name: /pgvector.*index/i });
    await user.click(indexSelector);
    expect(indexSelector).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Add new index/ }));
    expect(onOpenIndexRegistry).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Create index/ }));
    expect(onOpenIndexRegistry).toHaveBeenCalledTimes(2);
  }, 10000);

  it("requires a named index before proceeding", async () => {
    const user = userEvent.setup();
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: 1536 })] });

    await toStoreStep(user);

    // The suggested new index satisfies the step; emptying the field doesn't.
    expect(getNextButton()).toBeEnabled();
    await user.clear(screen.getByLabelText(/New pgvector/));
    expect(getNextButton()).toBeDisabled();

    await useExistingIndex(user, "alpha");
    expect(getNextButton()).toBeEnabled();
  }, 15000);

  it("closes only the index popup on Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha" })], onClose });

    await toStoreStep(user);
    await user.click(screen.getByRole("radio", { name: /Existing index/ }));
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

    // Template step: the served catalog's first entry is preselected.
    expect(await screen.findByRole("radio", { name: /Semantic \+ keyword/ })).toBeChecked();
    await user.click(getNextButton());

    await nameIt(user, "Pipe");
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
      // The server builds tool graphs from the shipped catalog; the wizard
      // sends the choices and creates exactly what comes back.
      expect(api.scaffoldToolTemplate).toHaveBeenCalledWith("token", "semantic-keyword", {
        backend: "pgvector",
        index_name: "alpha",
        embedding_connection_id: OPENROUTER_CONNECTION,
        embedding_model: "emb-1",
        reranking_connection_id: null,
        reranking_model: null,
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

  it("clears a failed create's banner when the user edits the pipeline again", async () => {
    const user = userEvent.setup();
    api.createPipeline.mockRejectedValueOnce(new Error(CREATE_ERROR));

    renderWizard({ kind: "ingestion", indexes: [makeVectorIndex({ name: "alpha" })] });

    await toStoreStep(user);
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));
    expect(await screen.findByText(new RegExp(CREATE_ERROR))).toBeInTheDocument();

    // Back to the processing step and pick the model again: the banner
    // describes an attempt whose options no longer match the form.
    await user.click(screen.getByRole("button", { name: /Processing/ }));
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));

    expect(screen.queryByText(new RegExp(CREATE_ERROR))).not.toBeInTheDocument();
  }, 15000);

  it("derives initial chunking values from the backend node catalog", async () => {
    const user = userEvent.setup();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({
      indexes: [makeVectorIndex({ name: "alpha", dimension: 1536 })],
      nodeSpecs: [
        makeNodeSpec({
          type: "chunker.token",
          default_config: { chunk_size: 384, chunk_overlap: 48 },
        }),
      ],
    });

    await toStoreStep(user);
    await useExistingIndex(user, "alpha");
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() =>
      expect(pipelineUtils.buildIngestionDefinition).toHaveBeenCalledWith(
        "pgvector",
        expect.objectContaining({ chunkSize: 384, chunkOverlap: 48 }),
      ),
    );
  });

  it("applies chunking presets on the processing step", async () => {
    const user = userEvent.setup();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: null })] });

    await nameIt(user, "Pipe");
    await user.click(getNextButton());

    await user.click(screen.getByRole("radio", { name: /Fine/ }));
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());
    await useExistingIndex(user, "alpha");
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      expect(pipelineUtils.buildIngestionDefinition).toHaveBeenCalledWith("pgvector", {
        indexName: "alpha",
        indexDimension: undefined,
        embeddingConnectionId: OPENROUTER_CONNECTION,
        embeddingModel: "emb-1",
        intake: "text",
        chunkSize: 512,
        chunkOverlap: 64,
        includeBm25: true,
        indexNameMaxLength: 45,
      });
    });
  }, 15000);

  it("scaffolds the chosen intake preset and drops chunking where nothing is chunked", async () => {
    // The image-only preset wires no chunker, so a chunk-size control on the
    // step would edit a node the pipeline does not have.
    const user = userEvent.setup();
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: null })] });

    await nameIt(user, "Pipe");
    await user.click(getNextButton());

    expect(screen.getByRole("radiogroup", { name: "Chunking preset" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Everything as images/ }));
    expect(screen.queryByRole("radiogroup", { name: "Chunking preset" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(pipelineUtils.buildIngestionDefinition).toHaveBeenCalledWith(
        "pgvector",
        expect.objectContaining({ intake: "images" }),
      );
    });
  }, 15000);

  it("labels the chunk window in tokens, the unit the chunker it builds counts in", async () => {
    // This wizard scaffolds a `chunker.token` node, and every embedding-limit
    // check downstream is expressed in tokens — so calling the same numbers
    // "words" is not merely inconsistent with the setup wizard, it states the
    // wrong unit for the field it labels.
    const user = userEvent.setup();
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: null })] });

    await nameIt(user, "Pipe");
    await user.click(getNextButton());

    await user.click(screen.getByRole("button", { name: /Advanced chunking/ }));

    expect(screen.getByLabelText("Chunk size (tokens)")).toBeInTheDocument();
    expect(screen.getByLabelText("Chunk overlap (tokens)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/\(words\)/)).not.toBeInTheDocument();
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
    await nameIt(user, "Pipe");
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

  it("keeps the review step out of reach until every required field is filled", async () => {
    // Gating only Next leaves the step list as a way to click straight past a
    // required field, and the wizard then submits without it.
    const user = userEvent.setup();
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: 1536 })] });

    expect(screen.getByRole("button", { name: /Review/ })).toBeDisabled();

    await nameIt(user, "Pipe");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());
    await useExistingIndex(user, "alpha");

    expect(screen.getByRole("button", { name: /Review/ })).toBeEnabled();
  }, 15000);

  it("previews the hybrid scaffold in topology order instead of serialized node order", async () => {
    const user = userEvent.setup();
    pipelineUtils.buildIngestionDefinition.mockReturnValue({
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
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })] });

    await toStoreStep(user);
    await user.click(getNextButton());

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
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })] });

    await toStoreStep(user);
    await user.click(getNextButton());

    expect(flowPlayerSpy).toHaveBeenLastCalledWith(expect.objectContaining({ autoPlay: false }));
  }, 15000);

  it("skips the embedding step for the count template and creates without a model", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({
      kind: "retrieval",
      indexes: [
        makeVectorIndex({ name: "alpha", backend: "pgvector" }),
        makeVectorIndex({ name: BM25_INDEX, backend: "pgvector", vector_type: "sparse" }),
      ],
      onCreated,
    });

    await user.click(await screen.findByRole("radio", { name: /Count matches/ }));
    await user.click(getNextButton());
    await nameIt(user, "Counter");
    await user.click(getNextButton());
    await chooseIndex(user, BM25_INDEX);
    await user.click(getNextButton());

    // No embedding step — count doesn't embed. Straight to review + create.
    expect(screen.queryByTestId(EMBEDDING_SELECTOR_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByText("Count matches")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      // The count graph itself is the server's; what the wizard owns is
      // sending the template and the store it was pointed at.
      expect(api.scaffoldToolTemplate).toHaveBeenCalledWith(
        "token",
        "count",
        expect.objectContaining({ backend: "pgvector", index_name: BM25_INDEX }),
      );
      expect(onCreated).toHaveBeenCalled();
    });
  }, 15000);

  it("renames the pipeline for the template it now builds, unless the user named it", async () => {
    // The suggestion describes the template, so keeping the previous one
    // creates a pipeline named after a template it isn't.
    const user = userEvent.setup();
    renderWizard({ kind: "retrieval" });

    await user.click(await screen.findByRole("radio", { name: /Semantic \+ keyword/ }));
    await user.click(getNextButton());
    expect(screen.getByPlaceholderText(/Research library/)).toHaveValue(
      "Semantic + keyword search",
    );

    await user.click(screen.getByRole("button", { name: /Template/ }));
    await user.click(screen.getByRole("radio", { name: /Reranked search/ }));
    await user.click(getNextButton());
    expect(screen.getByPlaceholderText(/Research library/)).toHaveValue("Reranked search");

    await nameIt(user, "My tool");
    await user.click(screen.getByRole("button", { name: /Template/ }));
    await user.click(screen.getByRole("radio", { name: /Count matches/ }));
    await user.click(getNextButton());

    expect(screen.getByPlaceholderText(/Research library/)).toHaveValue("My tool");
  }, 20000);

  it("offers the BM25 index to a lexical template and the dense one to a search template", async () => {
    // Count matches reads a BM25 index and derives nothing, so offering it a
    // dense index asks for a store its graph never touches.
    const user = userEvent.setup();
    renderWizard({
      kind: "retrieval",
      indexes: [
        makeVectorIndex({ name: "alpha", backend: "pgvector" }),
        makeVectorIndex({ name: BM25_INDEX, backend: "pgvector", vector_type: "sparse" }),
      ],
    });

    await user.click(await screen.findByRole("radio", { name: /Count matches/ }));
    await user.click(getNextButton());
    await nameIt(user, "Counter");
    await user.click(getNextButton());

    await user.click(screen.getByRole("combobox", { name: /BM25 index/i }));
    expect(screen.getByRole("option", { name: /alpha-bm25/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^alpha ·/ })).not.toBeInTheDocument();
  }, 20000);

  it("suggests the embedding model the selected index was written with", async () => {
    const user = userEvent.setup();
    const ingestionModel = makeCatalogModel({
      id: INGESTION_MODEL_ID,
      name: "Wrote the index",
      connection_id: OPENROUTER_CONNECTION,
      dimension: 768,
    });
    const other = makeCatalogModel({ id: "other-model", name: "Other", dimension: 1536 });
    api.fetchPipelines.mockResolvedValue([
      makePipeline({
        kind: "ingestion",
        definition: {
          nodes: [
            {
              id: "embed-chunks",
              type: "embedder.text",
              name: "Embedder",
              config: { connection_id: OPENROUTER_CONNECTION, model_name: INGESTION_MODEL_ID },
            },
            {
              id: "index-chunks",
              type: "indexer.vector",
              name: "Indexer",
              config: { backend: "pgvector", index_name: "alpha" },
            },
          ],
          edges: [],
        },
      }),
    ]);

    renderWizard({
      kind: "retrieval",
      indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })],
      embeddingModels: [other, ingestionModel],
      embeddingCatalog: makeModelCatalog([other, ingestionModel]),
    });

    await user.click(await screen.findByRole("radio", { name: /Semantic \+ keyword/ }));
    await user.click(getNextButton());
    await nameIt(user, "Query");
    await user.click(getNextButton());
    await chooseIndex(user, "alpha");
    await user.click(getNextButton());

    await waitFor(() =>
      expect(screen.getByTestId("embedding-selected")).toHaveTextContent(INGESTION_MODEL_ID),
    );
    // A model of the wrong width is marked where it is chosen, not only after.
    expect(screen.getByText(/1,536d — alpha stores 768d/)).toBeInTheDocument();
  }, 20000);

  it("lists a refused definition's findings under the nodes they name", async () => {
    // The server sends structured findings; folding them into one string
    // drops the node each names and leaves an empty trailing section.
    const user = userEvent.setup();
    api.createPipeline.mockRejectedValueOnce(
      new ApiError(400, "errors: ...", {
        errors: [MISSING_INPUT_ERROR],
        issues: [
          {
            message: MISSING_INPUT_ERROR,
            severity: "error",
            code: "graph.required_input",
            node_id: "rerank-results",
          },
        ],
      }),
    );
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })] });

    await toStoreStep(user);
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    expect(await screen.findByText(/Fix these before creating/)).toBeInTheDocument();
    expect(screen.getByText(MISSING_INPUT_ERROR)).toBeInTheDocument();
    expect(screen.getByText(/This pipeline can't be created yet\./)).toBeInTheDocument();
  }, 20000);

  it("warns about a width mismatch the catalog never published", async () => {
    // OpenRouter publishes no dimension for any embedding model, so a check
    // reading the catalog value alone is silent for exactly the models it
    // exists to catch — the resolved width is what the index is compared to.
    const user = userEvent.setup();
    const unpublished = makeCatalogModel({ id: "no-published-width", dimension: null });
    api.fetchEmbeddingDimension.mockResolvedValue({
      connection_id: unpublished.connection_id,
      model_id: unpublished.id,
      dimension: 3072,
    });
    renderWizard({
      kind: "retrieval",
      indexes: [makeVectorIndex({ name: "alpha", dimension: 768 })],
      embeddingModels: [unpublished],
      embeddingCatalog: makeModelCatalog([unpublished]),
    });

    await user.click(await screen.findByRole("radio", { name: /Semantic \+ keyword/ }));
    await user.click(getNextButton());
    await nameIt(user, "Query");
    await user.click(getNextButton());
    await chooseIndex(user, "alpha");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));

    expect(await screen.findByText(/produces 3072-dimension vectors/)).toBeInTheDocument();
    expect(screen.getByText(/stores 768/)).toBeInTheDocument();
  }, 20000);

  it("skips store and embedding for the blank template, creating an input-only graph", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({ kind: "retrieval", onCreated });

    await user.click(await screen.findByRole("radio", { name: /Blank pipeline/ }));
    await user.click(getNextButton());
    await nameIt(user, "Scratch");
    // No store step and no embedding step — straight from name to review.
    await user.click(getNextButton());

    expect(screen.queryByTestId(EMBEDDING_SELECTOR_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByText("Blank pipeline")).toBeInTheDocument();
    // The blank scaffold declares no vector store.
    expect(screen.queryByText(/no index/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      // The blank scaffold names no index — the wizard skipped that step.
      expect(api.scaffoldToolTemplate).toHaveBeenCalledWith(
        "token",
        "blank",
        expect.objectContaining({ index_name: null }),
      );
      expect(onCreated).toHaveBeenCalled();
    });
  }, 15000);

  it("collects a reranking model for the reranked template before it can be created", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({
      kind: "retrieval",
      indexes: [makeVectorIndex({ name: "alpha", backend: "pgvector" })],
      onCreated,
    });

    await user.click(await screen.findByRole("radio", { name: /Reranked search/ }));
    await user.click(getNextButton());
    await user.type(screen.getByPlaceholderText(/Research library/), "Reranked");
    await user.click(getNextButton());
    await chooseIndex(user, "alpha");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());

    // The reranker node refuses to run unconfigured, so the wizard collects
    // the model here rather than creating a pipeline that always fails.
    expect(getNextButton()).toBeDisabled();
    await user.click(screen.getByTestId(RERANKING_SELECTOR_TEST_ID));
    expect(getNextButton()).toBeEnabled();
    await user.click(getNextButton());

    expect(screen.getByText("Rerank")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  }, 15000);

  it("asks what the pipeline reads before asking where the vectors go", async () => {
    // Picking the store first makes the user commit to an index before
    // knowing what has to fit in it; the model decides the width.
    renderWizard();

    const steps = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((label) => /^[1-4](Name|Processing|Vector store|Review)$/.test(label));

    expect(steps).toEqual(["1Name", "2Processing", "3Vector store", "4Review"]);
  });

  it("blocks the images intake on a model that states it reads text only", async () => {
    // "Everything as images" hands the embedder images; a model that lists
    // its inputs without `image` has stated it cannot take them.
    const user = userEvent.setup();
    const textOnly = makeCatalogModel({
      id: "text-only",
      name: "Text Only",
      input_modalities: ["text"],
    });
    renderWizard({
      embeddingModels: [textOnly],
      embeddingCatalog: makeModelCatalog([textOnly]),
    });

    await nameIt(user, "Images");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(screen.getByRole("radio", { name: /Everything as images/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/reads text only/);
    expect(getNextButton()).toBeDisabled();
    // A step's requirement gates the step list too, or the sidebar walks
    // straight past it — every step after the unsatisfied one is unreachable.
    expect(screen.getByRole("button", { name: /Vector store/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Review/ })).toBeDisabled();
  }, 15000);

  it("collects a vision model for the described-images intake before moving on", async () => {
    // The vision shell refuses to run without a model, so the wizard asks for
    // one rather than creating a pipeline that fails on every upload.
    const user = userEvent.setup();
    renderWizard();

    await nameIt(user, "Described");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(screen.getByRole("radio", { name: DESCRIBED_INTAKE }));

    expect(screen.getByTestId(VISION_SELECTOR_TEST_ID)).toBeInTheDocument();
    expect(getNextButton()).toBeDisabled();

    await user.click(screen.getByTestId(VISION_SELECTOR_TEST_ID));
    expect(getNextButton()).toBeEnabled();
  }, 15000);

  it("blocks the described-images intake on a vision model that reads text only", async () => {
    const user = userEvent.setup();
    const textOnly = makeCatalogModel({
      id: "chat-text-only",
      name: "Text Chat",
      input_modalities: ["text"],
    });
    renderWizard({
      vision: {
        models: [textOnly],
        catalog: makeModelCatalog([textOnly]),
        loading: false,
        error: null,
        onVisible: () => undefined,
        onRetry: () => undefined,
      },
    });

    await nameIt(user, "Described");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(screen.getByRole("radio", { name: DESCRIBED_INTAKE }));
    await user.click(screen.getByTestId(VISION_SELECTOR_TEST_ID));

    expect(screen.getByRole("alert")).toHaveTextContent(/sends it images to describe/);
    expect(getNextButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /Review/ })).toBeDisabled();
  }, 15000);

  it("keeps the embedding model out of the image question when a vision node reads them", async () => {
    // The described intake hands the embedder text, so a text-only embedding
    // model is correct there — warning about it would be false.
    const user = userEvent.setup();
    const textOnly = makeCatalogModel({
      id: "text-only",
      name: "Text Only",
      input_modalities: ["text"],
    });
    renderWizard({
      embeddingModels: [textOnly],
      embeddingCatalog: makeModelCatalog([textOnly]),
    });

    await nameIt(user, "Described");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(screen.getByRole("radio", { name: DESCRIBED_INTAKE }));
    await user.click(screen.getByTestId(VISION_SELECTOR_TEST_ID));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getNextButton()).toBeEnabled();
  }, 15000);

  it("warns but still creates when the model states no input modalities", async () => {
    // Absence of a capability mark means "not stated", never "cannot".
    const user = userEvent.setup();
    const unstated = makeCatalogModel({
      id: "unstated",
      name: "Unstated",
      input_modalities: [],
    });
    renderWizard({
      embeddingModels: [unstated],
      embeddingCatalog: makeModelCatalog([unstated]),
    });

    await nameIt(user, "Images");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(screen.getByRole("radio", { name: /Everything as images/ }));

    expect(screen.getByRole("status")).toHaveTextContent(/does not state whether it reads images/);
    expect(getNextButton()).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  }, 15000);

  it("keeps the chosen model when an index written by another one is picked", async () => {
    // An ingestion pipeline decides the model and the index follows. Adopting
    // the index's existing embedder is how a text-only model ends up selected
    // under an image intake — the state issue #281 reported.
    const user = userEvent.setup();
    const chosen = makeCatalogModel({
      id: "vision-embedder",
      name: "Vision",
      input_modalities: ["text", "image"],
    });
    const wroteTheIndex = makeCatalogModel({
      id: INGESTION_MODEL_ID,
      connection_id: OPENROUTER_CONNECTION,
      input_modalities: ["text"],
    });
    api.fetchPipelines.mockResolvedValue([
      makePipeline({
        kind: "ingestion",
        definition: {
          nodes: [
            {
              id: "embed-chunks",
              type: "embedder.text",
              name: "Embedder",
              config: { connection_id: OPENROUTER_CONNECTION, model_name: INGESTION_MODEL_ID },
            },
            {
              id: "index-chunks",
              type: "indexer.vector",
              name: "Indexer",
              config: { backend: "pgvector", index_name: "alpha" },
            },
          ],
          edges: [],
        },
      }),
    ]);
    renderWizard({
      indexes: [makeVectorIndex({ name: "alpha", dimension: 1536 })],
      embeddingModels: [chosen, wroteTheIndex],
      embeddingCatalog: makeModelCatalog([chosen, wroteTheIndex]),
    });

    await nameIt(user, "Images");
    await user.click(getNextButton());
    await user.click(screen.getByRole("radio", { name: /Everything as images/ }));
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(getNextButton());
    await useExistingIndex(user, "alpha");
    await user.click(screen.getByRole("button", { name: /Processing/ }));

    expect(screen.getByTestId("embedding-selected")).toHaveTextContent("vision-embedder");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 20000);

  it("suggests a per-account index name and re-seeds it per backend until typed", async () => {
    const user = userEvent.setup();
    renderWizard();
    const suggested = defaultIndexName({ id: USER_ID, email: USER_EMAIL }, 45);

    await toStoreStep(user);
    const field = screen.getByLabelText(/New pgvector/);
    expect(field).toHaveValue(suggested);

    // Re-seeds while the suggestion is still the wizard's own.
    await user.click(screen.getByRole("button", { name: /Pinecone/ }));
    expect(screen.getByLabelText(/New Pinecone/)).toHaveValue(suggested);

    await user.clear(screen.getByLabelText(/New Pinecone/));
    await user.type(screen.getByLabelText(/New Pinecone/), "my-store");
    await user.click(screen.getByRole("button", { name: /pgvector/ }));
    expect(screen.getByLabelText(/New pgvector/)).toHaveValue("my-store");
  }, 20000);

  it("says which indexes exist when the pipeline they were made for is refused", async () => {
    // The indexes outlive a refused attempt, and a retry reuses them rather
    // than making a second pair. Leaving that unsaid orphans them silently.
    const user = userEvent.setup();
    api.createPipeline.mockRejectedValueOnce(new Error(CREATE_ERROR));
    api.listIndexes.mockResolvedValue([]);
    renderWizard();

    await toStoreStep(user);
    await user.clear(screen.getByLabelText(/New pgvector/));
    await user.type(screen.getByLabelText(/New pgvector/), "vault");
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    expect(
      await screen.findByText(/vault and vault-bm25 were already created and will be reused/),
    ).toBeInTheDocument();
  }, 20000);

  it("refuses a new index the model's width cannot size", async () => {
    // The store step knows the width has not resolved; leaving it to Create
    // reports it on a screen showing none of the fields it is about.
    const user = userEvent.setup();
    const unpublished = makeCatalogModel({ id: "no-width", dimension: null });
    api.fetchEmbeddingDimension.mockRejectedValue(new Error("unreachable"));
    renderWizard({
      embeddingModels: [unpublished],
      embeddingCatalog: makeModelCatalog([unpublished]),
    });

    await toStoreStep(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /vector width has not resolved, so .* cannot be sized/,
    );
    expect(getNextButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /Review/ })).toBeDisabled();
  }, 20000);

  it("refuses a typed name the newly chosen backend has no room for", async () => {
    // Backends cap name length differently, and the cap reserves the BM25
    // sibling's suffix — a name typed under a roomier backend can outgrow it.
    const user = userEvent.setup();
    renderWizard({
      backends: [
        makeBackendInfo(),
        makePineconeBackendInfo({
          capabilities: {
            ...makePineconeBackendInfo().capabilities,
            index_name_max_length: 25,
          },
        }),
      ],
    });

    await toStoreStep(user);
    await user.clear(screen.getByLabelText(/New pgvector/));
    await user.type(screen.getByLabelText(/New pgvector/), "a".repeat(30));
    expect(getNextButton()).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Pinecone/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/allows 20 characters/);
    expect(getNextButton()).toBeDisabled();
  }, 20000);

  it("asks again about a second model that also states no modalities", async () => {
    // A dismissal answers for the model it was shown under; inheriting it
    // silences the warning for a model nobody has been told about.
    const user = userEvent.setup();
    const first = makeCatalogModel({ id: "unstated-one", name: "One", input_modalities: [] });
    const second = makeCatalogModel({ id: "unstated-two", name: "Two", input_modalities: [] });
    renderWizard({
      embeddingModels: [first, second],
      embeddingCatalog: makeModelCatalog([first, second]),
    });

    await nameIt(user, "Images");
    await user.click(getNextButton());
    await user.click(screen.getByTestId(EMBEDDING_SELECTOR_TEST_ID));
    await user.click(screen.getByRole("radio", { name: /Everything as images/ }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("embedding-selector-second"));

    expect(screen.getByRole("status")).toHaveTextContent(/does not state whether it reads images/);
  }, 20000);

  it("names the dense index when its BM25 sibling fails to be created", async () => {
    // The pair is two requests. The second failing leaves the first behind,
    // and reporting only "unable to create the index" hides an index the user
    // was never told about.
    const user = userEvent.setup();
    api.listIndexes.mockResolvedValue([]);
    api.createIndex.mockImplementation(
      async (_token: string, payload: { vector_type?: string }) => {
        if (payload.vector_type === "sparse") throw new Error("BM25 unavailable");
        return makeVectorIndex({ name: "vault", dimension: 1536 });
      },
    );
    renderWizard();

    await toStoreStep(user);
    await user.clear(screen.getByLabelText(/New pgvector/));
    await user.type(screen.getByLabelText(/New pgvector/), "vault");
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    expect(await screen.findByText(/BM25 unavailable/)).toBeInTheDocument();
    expect(
      screen.getByText(/vault was already created and will be reused when you try again/),
    ).toBeInTheDocument();
    // The pipeline was never submitted: it would write into a store half of
    // which does not exist.
    expect(api.createPipeline).not.toHaveBeenCalled();
  }, 20000);

  it("refuses a new index name an index of another width already holds", async () => {
    // The name is only a name until it is created; if it already exists at a
    // different width, creating the pipeline writes vectors nothing accepts
    // and every upsert is rejected at ingest.
    const user = userEvent.setup();
    const suggested = defaultIndexName({ id: USER_ID, email: USER_EMAIL }, 45);
    renderWizard({ indexes: [makeVectorIndex({ name: suggested, dimension: 768 })] });

    await toStoreStep(user);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /already exists and stores 768d, the model produces 1,536d/,
    );
    expect(getNextButton()).toBeDisabled();

    await user.clear(screen.getByLabelText(/New pgvector/));
    await user.type(screen.getByLabelText(/New pgvector/), "somewhere-else");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getNextButton()).toBeEnabled();
  }, 20000);

  it("creates the named index and its BM25 sibling before the pipeline", async () => {
    // The pipeline writes both, and an index nothing registered is one no
    // other pipeline can be pointed at.
    const user = userEvent.setup();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    api.listIndexes.mockResolvedValue([]);
    renderWizard();

    await toStoreStep(user);
    await user.clear(screen.getByLabelText(/New pgvector/));
    await user.type(screen.getByLabelText(/New pgvector/), "vault");
    await user.click(getNextButton());
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      expect(api.createIndex).toHaveBeenCalledWith("token", {
        backend: "pgvector",
        name: "vault",
        vector_type: "dense",
        dimension: 1536,
        metric: "cosine",
      });
      expect(api.createIndex).toHaveBeenCalledWith("token", {
        backend: "pgvector",
        name: "vault-bm25",
        vector_type: "sparse",
      });
      expect(api.createPipeline).toHaveBeenCalled();
    });
  }, 20000);

  it("blocks the count template on a backend without count support", async () => {
    const user = userEvent.setup();
    renderWizard({
      kind: "retrieval",
      backends: [makeBackendInfo(), makePineconeBackendInfo()],
      indexes: [makeVectorIndex({ name: "cloud", backend: "pinecone" })],
    });

    await user.click(await screen.findByRole("radio", { name: /Count matches/ }));
    await user.click(getNextButton());
    await nameIt(user, "Counter");
    await user.click(getNextButton());

    // Pinecone can't run count — selecting it warns and blocks proceeding.
    await user.click(screen.getByRole("button", { name: /Pinecone/ }));
    expect(screen.getByRole("status")).toHaveTextContent(/can't run "Count matches"/);
    expect(getNextButton()).toBeDisabled();
  }, 15000);
});

describe("CreatePipelineWizard backend selection", () => {
  beforeEach(() => {
    pipelineUtils.buildIngestionDefinition.mockReturnValue({ nodes: [], edges: [] });
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
    await toStoreStep(user);
    await user.click(screen.getByRole("radio", { name: /Existing index/ }));
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
