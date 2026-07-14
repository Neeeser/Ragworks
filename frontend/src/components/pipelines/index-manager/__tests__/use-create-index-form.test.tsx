import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

import { useCreateIndexForm } from "@/components/pipelines/index-manager/use-create-index-form";
import { fetchEmbeddingDimension } from "@/lib/api";
import { makeBackendInfo, makeCatalogModel, makeModelCatalog } from "@/test/fixtures";

import type { EmbeddingDimensionResponse } from "@/lib/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const callbacks = {
  onCreateStart: vi.fn(),
  onCreated: vi.fn(),
  onError: vi.fn(),
};

describe("useCreateIndexForm model dimensions", () => {
  it("ignores a late dimension response after another model is selected", async () => {
    const firstDimension = deferred<EmbeddingDimensionResponse>();
    vi.mocked(fetchEmbeddingDimension).mockReturnValueOnce(firstDimension.promise);
    const first = makeCatalogModel({ connection_id: "conn-a", id: "first", dimension: null });
    const second = makeCatalogModel({ connection_id: "conn-b", id: "second", dimension: 384 });
    const { result } = renderHook(() =>
      useCreateIndexForm({
        token: "token",
        backendInfo: makeBackendInfo(),
        embeddingModels: [first, second],
        ...callbacks,
      }),
    );

    act(() => {
      result.current.handleDimensionModeChange("model");
      result.current.handleSelectEmbeddingModel(first);
      result.current.handleSelectEmbeddingModel(second);
    });
    expect(result.current.createForm.dimension).toBe(384);

    await act(async () => {
      firstDimension.resolve({ connection_id: "conn-a", model_id: "first", dimension: 1536 });
      await firstDimension.promise;
    });

    expect(result.current.createForm.dimension).toBe(384);
  });

  it("blocks creation without clearing identity when a refresh removes the exact model", () => {
    const selected = makeCatalogModel({
      connection_id: "conn-a",
      connection_label: "Provider A",
      id: "shared-id",
      dimension: 768,
    });
    const otherConnection = makeCatalogModel({
      connection_id: "conn-b",
      id: "shared-id",
      dimension: 768,
    });
    const { result, rerender } = renderHook(
      ({ models, catalog }) =>
        useCreateIndexForm({
          token: "token",
          backendInfo: makeBackendInfo(),
          embeddingModels: models,
          embeddingCatalog: catalog,
          ...callbacks,
        }),
      { initialProps: { models: [selected], catalog: makeModelCatalog([selected]) } },
    );

    act(() => {
      result.current.setName("documents");
      result.current.handleDimensionModeChange("model");
      result.current.handleSelectEmbeddingModel(selected);
    });
    expect(result.current.createDisabled).toBe(false);

    rerender({ models: [otherConnection], catalog: makeModelCatalog([otherConnection]) });

    expect(result.current.selectedEmbeddingModelId).toBe("shared-id");
    expect(result.current.selectedEmbeddingModel).toBeNull();
    expect(result.current.createForm.dimension).toBeUndefined();
    expect(result.current.createDisabled).toBe(true);
    expect(result.current.createDisabledReason).toBe(
      "Selected model is no longer available from Provider A. Select another model.",
    );
  });
});
