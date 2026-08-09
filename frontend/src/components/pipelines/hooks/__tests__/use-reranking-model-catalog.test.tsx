import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRerankingModelCatalog } from "@/components/pipelines/hooks/use-reranking-model-catalog";
import * as apiModule from "@/lib/api";
import { makeCatalogModel, makeConnectionCatalogError, makeModelCatalog } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

describe("useRerankingModelCatalog", () => {
  beforeEach(() => {
    api.fetchRerankingModels.mockReset();
  });

  it("keeps one connection's failure off the catalog-wide error channel", async () => {
    const model = makeCatalogModel({ id: "reranker-1" });
    const broken = makeConnectionCatalogError({ connection_id: "broken" });
    api.fetchRerankingModels.mockResolvedValue(makeModelCatalog([model], [broken]));

    const { result } = renderHook(() => useRerankingModelCatalog("token", "reranking-user"));

    await waitFor(() => expect(result.current.rerankingModels).toEqual([model]));
    // The reachable provider's models still load, and the failure travels as a
    // per-connection entry the picker renders against that provider alone.
    expect(result.current.rerankingConnectionErrors).toEqual([broken]);
    expect(result.current.rerankingModelsError).toBeNull();

    await act(async () => result.current.refreshModels());
    expect(api.fetchRerankingModels).toHaveBeenCalledTimes(2);
  });
});
