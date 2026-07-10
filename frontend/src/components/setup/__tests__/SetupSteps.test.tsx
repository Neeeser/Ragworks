import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// The key step probes @/lib/api validateProviderKey as the user types.
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

import { initialSetupWizardState } from "@/components/setup/lib/setup-wizard-reducer";
import { StepKey, StepModel } from "@/components/setup/SetupSteps";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";
import type { BackendInfo, EmbeddingModelInfo } from "@/lib/types";

const MINILM = "sentence-transformers/all-minilm-l6-v2";
const GOOD_KEY = "sk-or-good";

const models: EmbeddingModelInfo[] = [
  { id: "openai/text-embedding-3-large", name: "Embedding 3 Large", dimension: 3072 },
  { id: MINILM, name: "all-MiniLM-L6-v2", dimension: 384 },
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
    keyConfigured: true,
    saveKey: vi.fn(),
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
  };
}

describe("StepModel", () => {
  it("selects a model with its dimension and enables Continue", async () => {
    const wizard = makeWizard();
    render(<StepModel wizard={wizard} />);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /all-MiniLM-L6-v2/i }));

    expect(wizard.setChoices).toHaveBeenCalledWith({
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

describe("StepKey", () => {
  it("keeps Save & continue disabled until the pasted key verifies, then enables it", async () => {
    const { validateProviderKey } = await import("@/lib/api");
    vi.mocked(validateProviderKey).mockImplementation(async (_t, _p, key) => ({
      configured: true,
      valid: key === GOOD_KEY,
      message: key === GOOD_KEY ? null : "Invalid OpenRouter API key.",
    }));
    const wizard = makeWizard({ keyConfigured: false });
    render(<StepKey wizard={wizard} />);
    const save = () => screen.getByRole("button", { name: /save & continue/i });

    expect(save()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/openrouter api key/i), "sk-or-bad");
    expect(await screen.findByText("Invalid OpenRouter API key.")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/openrouter api key/i));
    await userEvent.type(screen.getByLabelText(/openrouter api key/i), GOOD_KEY);
    expect(await screen.findByText("Key verified.")).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });
});
