import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useBenchModel } from "@/components/prompts/hooks/use-bench-model";
import { makeCatalogModel } from "@/test/fixtures";

import type { CatalogModel } from "@/lib/types";

const served = makeCatalogModel({ id: "gpt-4.1-nano", connection_id: "conn-1" });

const shortlist = vi.hoisted(() => ({
  recent: [] as Array<{ entry: { model_id: string }; model: CatalogModel | null }>,
}));

vi.mock("@/components/models/hooks/use-model-shortlist", () => ({
  useModelShortlist: () => ({
    pinned: [],
    recent: shortlist.recent,
    isPinned: () => false,
    togglePin: () => {},
    recordUse: () => {},
    error: null,
    clearError: () => {},
  }),
}));

vi.mock("@/components/pipelines/hooks/use-llm-model-catalog", () => ({
  useLlmModelCatalog: () => ({
    llmModels: [served],
    llmConnectionErrors: [],
    llmModelsLoading: false,
    llmModelsError: null,
    llmCatalog: null,
    refreshModels: async () => {},
  }),
}));

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

describe("useBenchModel", () => {
  it("opens on the user's most recent chat model", () => {
    shortlist.recent = [{ entry: { model_id: served.id }, model: served }];

    const { result } = renderHook(() => useBenchModel());

    expect(result.current.model?.id).toBe(served.id);
  });

  it("skips a recent model its connection no longer serves", () => {
    // A shortlist entry that no longer resolves against the catalog would put
    // a model in the picker that no run could use.
    const dropped = { entry: { model_id: "retired-model" }, model: null };
    shortlist.recent = [dropped, { entry: { model_id: served.id }, model: served }];

    const { result } = renderHook(() => useBenchModel());

    expect(result.current.model?.id).toBe(served.id);
  });

  it("stays empty when the user has no recent chat model", () => {
    // An empty picker asks a better question than a guessed model answers.
    shortlist.recent = [];

    const { result } = renderHook(() => useBenchModel());

    expect(result.current.model).toBeNull();
  });
});
