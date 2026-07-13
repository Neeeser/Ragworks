import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePipelineWizard } from "@/components/pipelines/CreatePipelineWizard";
import * as apiModule from "@/lib/api";
import {
  makeBackendInfo,
  makePineconeBackendInfo,
  makePipeline,
  makeVectorIndex,
} from "@/test/fixtures";

import type { VectorIndex } from "@/lib/types";
import type { ComponentProps } from "react";

const pipelineUtils = {
  buildDefaultDefinition: vi.fn(),
};
const createPipelineLabel = "Create pipeline";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/components/pipelines/lib/pipeline-scaffold", () => ({
  buildDefaultDefinition: (...args: unknown[]) => pipelineUtils.buildDefaultDefinition(...args),
}));
vi.mock("@/components/pipelines/lib/pipeline-utils", () => ({
  sortIndexesByName: (indexes: { name: string }[]) =>
    [...indexes].sort((a, b) => a.name.localeCompare(b.name)),
  toFlowNodes: () => [],
  toFlowEdges: () => [],
}));
vi.mock("@/components/pipelines/flow/FlowPlayer", () => ({
  FlowPlayer: () => <div data-testid="flow-player" />,
}));
vi.mock("@/components/pipelines/EmbeddingModelSelectorCard", () => ({
  EmbeddingModelSelectorCard: ({ onSelectModel }: { onSelectModel: (id: string) => void }) => (
    <button type="button" data-testid="embedding-selector" onClick={() => onSelectModel("emb-1")}>
      pick model
    </button>
  ),
}));

const api = vi.mocked(apiModule);

type WizardProps = ComponentProps<typeof CreatePipelineWizard>;

function renderWizard(overrides: Partial<WizardProps> = {}) {
  const props: WizardProps = {
    open: true,
    token: "token",
    kind: "ingestion",
    indexes: [],
    backends: [makeBackendInfo(), makePineconeBackendInfo()],
    nodeSpecs: [],
    embeddingModels: [],
    embeddingModelsLoading: false,
    embeddingModelsError: null,
    onClose: () => undefined,
    onCreated: () => undefined,
    onOpenIndexManager: () => undefined,
    ...overrides,
  };
  return render(<CreatePipelineWizard {...props} />);
}

async function chooseIndex(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: new RegExp(name, "i") }));
}

describe("CreatePipelineWizard", () => {
  const pipeline = makePipeline({ kind: "ingestion", definition: { nodes: [], edges: [] } });

  beforeEach(() => {
    pipelineUtils.buildDefaultDefinition.mockReturnValue({ nodes: [], edges: [] });
  });

  it("renders nothing when closed", () => {
    const { container } = renderWizard({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("handles step navigation and index creation prompt", async () => {
    const user = userEvent.setup();
    const onOpenIndexManager = vi.fn();
    renderWizard({ onOpenIndexManager });

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Research library/), "New");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Select an index/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await chooseIndex(user, "alpha");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
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

    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await chooseIndex(user, "alpha");
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Embedding step for retrieval pipelines.
    expect(screen.getByTestId("embedding-selector")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Review step renders the animated preview + summary.
    expect(screen.getByTestId("flow-player")).toBeInTheDocument();
    expect(screen.getByText("Pipe")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith("retrieval", "pgvector", {
        indexName: "alpha",
        indexDimension: 768,
        embeddingModel: undefined,
        chunkSize: 1024,
        chunkOverlap: 200,
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

  it("applies chunking presets on the processing step", async () => {
    const user = userEvent.setup();
    api.createPipeline.mockResolvedValueOnce(pipeline);
    renderWizard({ indexes: [makeVectorIndex({ name: "alpha", dimension: null })] });

    await user.type(screen.getByPlaceholderText(/Research library/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await chooseIndex(user, "alpha");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("radio", { name: /Fine/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith("ingestion", "pgvector", {
        indexName: "alpha",
        indexDimension: undefined,
        embeddingModel: undefined,
        chunkSize: 512,
        chunkOverlap: 64,
        includeBm25: true,
        indexNameMaxLength: 45,
      });
    });
  }, 15000);

  it("shows summary defaults when details are missing", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole("button", { name: /Review/ }));

    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText(/no index/)).toBeInTheDocument();
    expect(screen.getByText("Workspace default")).toBeInTheDocument();
  });
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
    await user.click(screen.getByRole("button", { name: "Next" }));
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
