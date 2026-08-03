import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useResolvedEmbeddingDimension } from "@/components/pipelines/hooks/use-resolved-embedding-dimension";
import * as apiModule from "@/lib/api";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);
const TOKEN = "test-token";

describe("useResolvedEmbeddingDimension", () => {
  it("returns the catalog dimension without calling the endpoint", () => {
    const { result } = renderHook(() =>
      useResolvedEmbeddingDimension(TOKEN, "conn-a", "model-a", 1536),
    );

    expect(result.current).toBe(1536);
    expect(api.fetchEmbeddingDimension).not.toHaveBeenCalled();
  });

  it("falls back to a single endpoint lookup when the catalog publishes no width", async () => {
    api.fetchEmbeddingDimension.mockResolvedValueOnce({
      connection_id: "conn-b",
      model_id: "model-b",
      dimension: 768,
    });

    const { result } = renderHook(() =>
      useResolvedEmbeddingDimension(TOKEN, "conn-b", "model-b", null),
    );

    // In flight: unresolved, never treated as a mismatch.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(768));
    expect(api.fetchEmbeddingDimension).toHaveBeenCalledWith(TOKEN, "conn-b", "model-b");
    expect(api.fetchEmbeddingDimension).toHaveBeenCalledTimes(1);
  });

  it("memoises the lookup across separate hook instances for the same pair", async () => {
    api.fetchEmbeddingDimension.mockResolvedValueOnce({
      connection_id: "conn-c",
      model_id: "model-c",
      dimension: 384,
    });

    const first = renderHook(() => useResolvedEmbeddingDimension(TOKEN, "conn-c", "model-c", null));
    await waitFor(() => expect(first.result.current).toBe(384));

    // A second, independent instance for the same pair reads the cache --
    // never a second request, which is the anti-pattern this guards against.
    const second = renderHook(() =>
      useResolvedEmbeddingDimension(TOKEN, "conn-c", "model-c", null),
    );
    expect(second.result.current).toBe(384);
    expect(api.fetchEmbeddingDimension).toHaveBeenCalledTimes(1);
  });

  it("stays null after a failed lookup rather than surfacing an error", async () => {
    api.fetchEmbeddingDimension.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useResolvedEmbeddingDimension(TOKEN, "conn-d", "model-d", null),
    );

    expect(result.current).toBeNull();
    await waitFor(() => expect(api.fetchEmbeddingDimension).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("never requests when there is no token or no model selected", () => {
    const noToken = renderHook(() =>
      useResolvedEmbeddingDimension(null, "conn-e", "model-e", null),
    );
    expect(noToken.result.current).toBeNull();

    const noSelection = renderHook(() => useResolvedEmbeddingDimension(TOKEN, null, null, null));
    expect(noSelection.result.current).toBeNull();

    expect(api.fetchEmbeddingDimension).not.toHaveBeenCalled();
  });
});
