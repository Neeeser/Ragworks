import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/providers/setup-status-provider", () => ({
  useSetupStatus: () => ({ status: null, refresh: vi.fn(), markComplete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/model-catalog-cache", () => ({
  useSharedModelCatalog: () => ({
    data: { models: [], connection_errors: [] },
    loading: false,
    error: null,
    invalidated: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { useSetupWizard } from "@/components/setup/hooks/use-setup-wizard";
import * as api from "@/lib/api";

const CONNECTION_ID = "conn-1";
const MODEL_ID = "openai/text-embedding-3-small";
const createIndex = vi.mocked(api.createIndex);
const fetchEmbeddingDimension = vi.mocked(api.fetchEmbeddingDimension);

async function mountWizard() {
  const hook = renderHook(() => useSetupWizard());
  // Let the connections/backends queries settle so nothing re-renders mid-assert.
  await waitFor(() => expect(hook.result.current.state.step).toBe("welcome"));
  return hook;
}

describe("useSetupWizard.ensureIndex — embedding dimension resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createIndex.mockResolvedValue({} as never);
  });

  it("probes the connection for a dimension the catalog left null, then creates the index", async () => {
    // Regression: OpenRouter embedding models report no catalog dimension, so
    // the wizard must resolve it before creating a dense index — otherwise the
    // create request omits the dimension and the backend answers 422.
    fetchEmbeddingDimension.mockResolvedValue({
      connection_id: CONNECTION_ID,
      model_id: MODEL_ID,
      dimension: 1536,
    });
    const { result } = await mountWizard();

    act(() => {
      result.current.setChoices({
        embeddingConnectionId: CONNECTION_ID,
        embeddingModel: MODEL_ID,
        embeddingDimension: null,
      });
    });

    await act(async () => {
      await result.current.ensureIndex();
    });

    expect(fetchEmbeddingDimension).toHaveBeenCalledWith(
      expect.any(String),
      CONNECTION_ID,
      MODEL_ID,
    );
    expect(createIndex).toHaveBeenCalledTimes(1);
    expect(createIndex.mock.calls[0][1]).toMatchObject({ dimension: 1536 });
    expect(result.current.state.choices.embeddingDimension).toBe(1536);
    expect(result.current.error).toBeNull();
  });

  it("does not probe when the catalog already provided a dimension", async () => {
    const { result } = await mountWizard();

    act(() => {
      result.current.setChoices({
        embeddingConnectionId: CONNECTION_ID,
        embeddingModel: "all-minilm",
        embeddingDimension: 384,
      });
    });

    await act(async () => {
      await result.current.ensureIndex();
    });

    expect(fetchEmbeddingDimension).not.toHaveBeenCalled();
    expect(createIndex.mock.calls[0][1]).toMatchObject({ dimension: 384 });
  });

  it("errors without creating an index when the dimension cannot be resolved", async () => {
    fetchEmbeddingDimension.mockResolvedValue({
      connection_id: CONNECTION_ID,
      model_id: "mystery/model",
      dimension: null,
    });
    const { result } = await mountWizard();

    act(() => {
      result.current.setChoices({
        embeddingConnectionId: CONNECTION_ID,
        embeddingModel: "mystery/model",
        embeddingDimension: null,
      });
    });

    await act(async () => {
      await result.current.ensureIndex();
    });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/dimension/i);
  });
});
