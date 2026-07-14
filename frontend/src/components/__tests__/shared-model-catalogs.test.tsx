import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchEmbeddingModels, listChatModels } from "@/lib/api";
import {
  clearModelCatalogsForUser,
  modelAvailability,
  useSharedModelCatalog,
} from "@/lib/model-catalog-cache";
import { makeCatalogModel, makeModelCatalog } from "@/test/fixtures";

vi.mock("@/lib/api", () => ({
  fetchEmbeddingModels: vi.fn(),
  listChatModels: vi.fn(),
}));

const mockedListChatModels = vi.mocked(listChatModels);
const mockedFetchEmbeddingModels = vi.mocked(fetchEmbeddingModels);

describe("shared model catalogs", () => {
  beforeEach(() => {
    clearModelCatalogsForUser("user-1");
    mockedListChatModels.mockReset();
    mockedFetchEmbeddingModels.mockReset();
  });

  it("shares one request between simultaneous selectors", async () => {
    mockedListChatModels.mockResolvedValue(makeModelCatalog());

    const { result } = renderHook(() => {
      const first = useSharedModelCatalog("user-1", "token", "chat", true);
      const second = useSharedModelCatalog("user-1", "token", "chat", true);
      return { first, second };
    });

    await waitFor(() => expect(result.current.first.data).not.toBeNull());
    expect(mockedListChatModels).toHaveBeenCalledTimes(1);
    expect(result.current.first.data).toBe(result.current.second.data);
  });

  it("renders retained data and revalidates when another selector mounts", async () => {
    mockedListChatModels
      .mockResolvedValueOnce(makeModelCatalog([makeCatalogModel({ id: "old" })]))
      .mockResolvedValueOnce(makeModelCatalog([makeCatalogModel({ id: "new" })]));
    const first = renderHook(() => useSharedModelCatalog("user-1", "token", "chat", true));
    await waitFor(() => expect(first.result.current.data?.models[0]?.id).toBe("old"));
    first.unmount();

    const second = renderHook(() => useSharedModelCatalog("user-1", "token", "chat", true));
    expect(second.result.current.data?.models[0]?.id).toBe("old");
    await waitFor(() => expect(second.result.current.data?.models[0]?.id).toBe("new"));
    expect(mockedListChatModels).toHaveBeenCalledTimes(2);
  });

  it("publishes a completed server refresh while the selector remains mounted", async () => {
    vi.useFakeTimers();
    mockedListChatModels
      .mockResolvedValueOnce(
        makeModelCatalog([makeCatalogModel({ id: "old" })], [], {
          freshness: "stale",
          refreshing: true,
          age_seconds: 12,
          warning: null,
        }),
      )
      .mockResolvedValueOnce(makeModelCatalog([makeCatalogModel({ id: "new" })]));

    const { result } = renderHook(() => useSharedModelCatalog("user-1", "token", "chat", true));
    await act(async () => Promise.resolve());
    expect(result.current.data?.models[0]?.id).toBe("old");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.data?.models[0]?.id).toBe("new");
    vi.useRealTimers();
  });

  it("defines disappeared selection states by exact connection identity", () => {
    const selected = makeCatalogModel({ connection_id: "conn-a", id: "same-id" });
    const otherConnection = makeCatalogModel({ connection_id: "conn-b", id: "same-id" });
    const freshMissing = makeModelCatalog([otherConnection]);
    const stale = makeModelCatalog([], [], {
      freshness: "stale",
      refreshing: true,
      age_seconds: 20,
      warning: null,
    });
    const errored = makeModelCatalog(
      [],
      [{ connection_id: "conn-a", connection_label: "A", message: "offline" }],
    );

    expect(modelAvailability(makeModelCatalog([selected]), "conn-a", "same-id")).toBe("available");
    expect(modelAvailability(freshMissing, "conn-a", "same-id")).toBe("missing");
    expect(modelAvailability(stale, "conn-a", "same-id")).toBe("unknown");
    expect(modelAvailability(errored, "conn-a", "same-id")).toBe("unknown");
  });
});
