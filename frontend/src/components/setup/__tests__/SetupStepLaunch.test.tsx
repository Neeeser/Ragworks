import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: () => reducedMotion.value,
}));

import { initialSetupWizardState } from "@/components/setup/lib/setup-wizard-reducer";
import { StepLaunch } from "@/components/setup/SetupStepLaunch";

import type { SetupWizardApi } from "@/components/setup/hooks/use-setup-wizard";

function makeWizard(overrides: Partial<SetupWizardApi> = {}): SetupWizardApi {
  const state = initialSetupWizardState("pgvector");
  return {
    state: {
      ...state,
      step: "launch",
      choices: { ...state.choices, collectionName: "First", indexName: "andrew-default" },
    },
    next: vi.fn(),
    back: vi.fn(),
    setChoices: vi.fn(),
    seedChunkDefaults: vi.fn(),
    setChunk: vi.fn(),
    connections: [],
    providerTypes: [],
    connectionsLoading: false,
    connectionsError: null,
    reloadConnections: vi.fn(),
    coverage: { embedding: true, chat: true, reranking: false, vector_store: true },
    providersReady: true,
    models: null,
    modelCatalog: null,
    refreshModels: vi.fn().mockResolvedValue(undefined),
    modelsLoading: false,
    modelsError: null,
    backends: null,
    suggestedModelId: null,
    hasRerankingProvider: false,
    rerankingModels: null,
    rerankingModelsLoading: false,
    ensureIndex: vi.fn(),
    finish: vi.fn().mockResolvedValue(undefined),
    openCollection: vi.fn(),
    completedCollectionId: null,
    busy: false,
    error: null,
    warning: null,
    clearError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  reducedMotion.value = false;
  vi.useRealTimers();
});

describe("StepLaunch", () => {
  it("runs the bootstrap once on mount", () => {
    const wizard = makeWizard();
    const { rerender } = render(<StepLaunch wizard={wizard} />);
    // A re-render must not bootstrap a second collection.
    rerender(<StepLaunch wizard={wizard} />);

    expect(wizard.finish).toHaveBeenCalledTimes(1);
  });

  it("shows the pulse only while the bootstrap is running", () => {
    const { rerender } = render(<StepLaunch wizard={makeWizard({ busy: true })} />);
    expect(screen.getByRole("status", { name: /installing pipelines/i })).toBeInTheDocument();

    rerender(<StepLaunch wizard={makeWizard({ busy: false })} />);
    expect(screen.queryByRole("status", { name: /installing pipelines/i })).toBeNull();
  });

  it("fades out and opens the collection once the bootstrap resolves", async () => {
    vi.useFakeTimers();
    const openCollection = vi.fn();
    render(<StepLaunch wizard={makeWizard({ completedCollectionId: "col-1", openCollection })} />);

    expect(openCollection).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(openCollection).toHaveBeenCalledTimes(1);
  });

  it("navigates without waiting on the fade under reduced motion", () => {
    reducedMotion.value = true;
    const openCollection = vi.fn();
    render(<StepLaunch wizard={makeWizard({ completedCollectionId: "col-1", openCollection })} />);

    expect(openCollection).toHaveBeenCalledTimes(1);
  });

  it("offers Back and a retry when the bootstrap fails, and does not navigate", async () => {
    // The step fires on its own, so a failure with no controls would strand
    // the user on a step with nothing to press.
    const wizard = makeWizard({ error: "Could not finish setup.", openCollection: vi.fn() });
    render(<StepLaunch wizard={wizard} />);

    expect(screen.getByText("Could not finish setup.")).toBeInTheDocument();
    expect(wizard.openCollection).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(wizard.back).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(wizard.finish).toHaveBeenCalledTimes(2);
  });

  it("waits for acknowledgement when the bootstrap warns instead of leaving", async () => {
    const openCollection = vi.fn();
    const wizard = makeWizard({
      completedCollectionId: "col-1",
      warning: "Setup finished with warnings: no reranker.",
      openCollection,
    });
    render(<StepLaunch wizard={wizard} />);

    expect(screen.getByText(/no reranker/)).toBeInTheDocument();
    expect(openCollection).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /open first/i }));
    expect(openCollection).toHaveBeenCalledTimes(1);
  });
});
