import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

import { initialSetupWizardState } from "@/components/setup/lib/setup-wizard-reducer";
import { StepModel, StepProviders } from "@/components/setup/SetupSteps";
import {
  makeCatalogModel,
  makeConnection,
  makeModelCatalog,
  makeProviderType,
} from "@/test/fixtures";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";
import type { BackendInfo, CatalogModel } from "@/lib/types";

const MINILM = "sentence-transformers/all-minilm-l6-v2";

const models: CatalogModel[] = [
  makeCatalogModel({
    id: "openai/text-embedding-3-large",
    name: "Embedding 3 Large",
    dimension: 3072,
  }),
  makeCatalogModel({ id: MINILM, name: "all-MiniLM-L6-v2", dimension: 384 }),
];

const backends = [
  {
    backend: "pgvector",
    label: "pgvector",
    available: true,
    configured: true,
    capabilities: { max_dimension: 2000 },
  },
] as unknown as BackendInfo[];

function makeWizard(overrides: Partial<SetupWizardApi> = {}): SetupWizardApi {
  return {
    state: initialSetupWizardState("pgvector"),
    next: vi.fn(),
    back: vi.fn(),
    setChoices: vi.fn(),
    connections: [makeConnection()],
    providerTypes: [makeProviderType()],
    connectionsLoading: false,
    connectionsError: null,
    reloadConnections: vi.fn(),
    coverage: { embedding: true, chat: true, vector_store: true },
    providersReady: true,
    models,
    modelsLoading: false,
    modelsError: null,
    backends,
    suggestedModelId: MINILM,
    ensureIndex: vi.fn(),
    finish: vi.fn(),
    busy: false,
    error: null,
    clearError: vi.fn(),
    ...overrides,
    modelCatalog: overrides.modelCatalog ?? makeModelCatalog(models),
    refreshModels: overrides.refreshModels ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("StepModel", () => {
  it("revalidates the catalog while the model step is visible", () => {
    const refreshModels = vi.fn().mockResolvedValue(undefined);
    render(<StepModel wizard={makeWizard({ refreshModels })} />);

    expect(refreshModels).toHaveBeenCalledTimes(1);
  });

  it("selects a model with its connection and dimension and enables Continue", async () => {
    const wizard = makeWizard();
    render(<StepModel wizard={wizard} />);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /all-MiniLM-L6-v2/i }));

    expect(wizard.setChoices).toHaveBeenCalledWith({
      embeddingConnectionId: "conn-openrouter-1",
      embeddingModel: MINILM,
      embeddingDimension: 384,
    });
  });

  it("flags models over the pgvector dimension cap", () => {
    render(<StepModel wizard={makeWizard()} />);

    expect(screen.getByText(/requires Pinecone/i)).toBeInTheDocument();
    expect(screen.getByText("Suggested")).toBeInTheDocument();
  });

  it("filters the catalog by search term", async () => {
    render(<StepModel wizard={makeWizard()} />);

    await userEvent.type(screen.getByLabelText(/search models/i), "minilm");

    expect(screen.queryByText("Embedding 3 Large")).not.toBeInTheDocument();
    expect(screen.getByText("all-MiniLM-L6-v2")).toBeInTheDocument();
  });
});

describe("StepProviders", () => {
  it("blocks Continue until every capability is covered", () => {
    const wizard = makeWizard({
      coverage: { embedding: true, chat: true, vector_store: false },
      providersReady: false,
    });
    render(<StepProviders wizard={wizard} />);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("enables Continue when embedding, chat, and a vector store are covered", async () => {
    const wizard = makeWizard();
    render(<StepProviders wizard={wizard} />);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(continueButton).toBeEnabled();
    await userEvent.click(continueButton);
    expect(wizard.next).toHaveBeenCalled();
  });

  it("lists connected providers with capability badges", () => {
    render(<StepProviders wizard={makeWizard()} />);

    expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    expect(screen.getAllByText("Embeddings").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chat").length).toBeGreaterThan(0);
  });
});
