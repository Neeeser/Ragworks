import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { routerReplace, statusRef } = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  statusRef: { current: null } as { current: SetupStatus | null },
}));

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/providers/setup-status-provider", () => ({
  useSetupStatus: () => ({
    status: statusRef.current,
    refresh: vi.fn(),
    markComplete: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
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
import { makeSetupStatus } from "@/test/fixtures";

import type { SetupStatus } from "@/lib/types";

const CONNECTION_ID = "conn-1";
const MODEL_ID = "openai/text-embedding-3-small";
const createIndex = vi.mocked(api.createIndex);
const fetchEmbeddingDimension = vi.mocked(api.fetchEmbeddingDimension);
const bootstrapSetup = vi.mocked(api.bootstrapSetup);

// Readiness is module state behind the provider mock, so it has to be cleared
// for every test or one describe's status decides another's resume step.
beforeEach(() => {
  statusRef.current = null;
});

async function mountWizard(expectedStep = "welcome") {
  const hook = renderHook(() => useSetupWizard());
  // Let the connections/backends queries settle so nothing re-renders mid-assert.
  await waitFor(() => expect(hook.result.current.state.step).toBe(expectedStep));
  return hook;
}

describe("useSetupWizard — resuming a partly-configured workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens on the model step when every required provider is already connected", async () => {
    // Regression: the wizard always resumed at providers, so a returning user
    // had to click Continue through a step with nothing left to do on it.
    statusRef.current = makeSetupStatus({
      has_embedding_provider: true,
      has_chat_provider: true,
      has_vector_store: true,
    });

    const { result } = await mountWizard("model");

    expect(result.current.state.step).toBe("model");
  });

  it("still opens on welcome for a workspace with no progress", async () => {
    statusRef.current = makeSetupStatus();

    const { result } = await mountWizard("welcome");

    expect(result.current.state.step).toBe("welcome");
  });

  it("lets Back reach the steps the resume skipped", async () => {
    statusRef.current = makeSetupStatus({
      has_embedding_provider: true,
      has_chat_provider: true,
      has_vector_store: true,
    });
    const { result } = await mountWizard("model");

    act(() => result.current.back());
    expect(result.current.state.step).toBe("providers");

    act(() => result.current.back());
    expect(result.current.state.step).toBe("welcome");
  });

  it("does not pull the user forward again after they navigate back", async () => {
    // The auth provider rotates its token every 12 minutes, re-running the
    // status query; re-resuming on that refresh would yank the user out of
    // the step they deliberately went back to.
    statusRef.current = makeSetupStatus({
      has_embedding_provider: true,
      has_chat_provider: true,
      has_vector_store: true,
    });
    const { result, rerender } = await mountWizard("model");
    act(() => result.current.back());

    statusRef.current = { ...statusRef.current };
    rerender();

    expect(result.current.state.step).toBe("providers");
  });
});

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

const BOOTSTRAPPED_COLLECTION_ID = "collection-1";

describe("useSetupWizard.finish — validation warnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders returned warnings before continuing to the collection", async () => {
    bootstrapSetup.mockResolvedValue({
      collection: { id: BOOTSTRAPPED_COLLECTION_ID } as never,
      warnings: [
        {
          code: "embedding_input_limit_exceeded",
          message: "Chunking may exceed the model limit.",
          severity: "warning",
        },
      ],
    });
    const { result } = await mountWizard();
    act(() => {
      result.current.setChoices({
        embeddingConnectionId: CONNECTION_ID,
        embeddingModel: MODEL_ID,
        collectionName: "First",
      });
    });

    await act(async () => result.current.finish());

    // finish records the outcome; the launch step decides when to leave, so
    // warnings can be acknowledged before the wizard disappears.
    expect(result.current.warning).toMatch(/chunking may exceed/i);
    expect(result.current.completedCollectionId).toBe(BOOTSTRAPPED_COLLECTION_ID);
    expect(routerReplace).not.toHaveBeenCalled();

    act(() => result.current.openCollection());
    expect(routerReplace).toHaveBeenCalledWith(`/collections/${BOOTSTRAPPED_COLLECTION_ID}`);
  });

  it("never bootstraps a second collection once one has been created", async () => {
    bootstrapSetup.mockResolvedValue({
      collection: { id: BOOTSTRAPPED_COLLECTION_ID } as never,
      warnings: [],
    });
    const { result } = await mountWizard();
    act(() => {
      result.current.setChoices({
        embeddingConnectionId: CONNECTION_ID,
        embeddingModel: MODEL_ID,
        collectionName: "First",
      });
    });

    await act(async () => result.current.finish());
    await act(async () => result.current.finish());

    expect(bootstrapSetup).toHaveBeenCalledTimes(1);
  });
});

describe("useSetupWizard.ensureIndex — shared create payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createIndex.mockResolvedValue({} as never);
  });

  it("shapes the create request through the shared payload builder", async () => {
    // The wizard used to hand-build this body, so every rule the builder
    // states — trim the name, drop placement fields a backend has no concept
    // of — silently skipped the one path every new user walks.
    const { result } = await mountWizard();

    act(() => {
      result.current.setChoices({
        embeddingConnectionId: CONNECTION_ID,
        embeddingModel: "all-minilm",
        embeddingDimension: 384,
        backend: "pgvector",
        indexName: "  ragworks-mine  ",
      });
    });

    await act(async () => {
      await result.current.ensureIndex();
    });

    const payload = createIndex.mock.calls[0][1];
    expect(payload.name).toBe("ragworks-mine");
    expect(payload).not.toHaveProperty("cloud");
    expect(payload).not.toHaveProperty("region");
  });
});
