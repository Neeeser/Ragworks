import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEvalsWorkspace } from "@/components/evals/hooks/use-evals-workspace";
import * as apiModule from "@/lib/api";
import { makeEvalDataset } from "@/test/fixtures";

import type { EvalDatasetGeneratePayload } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const ALPHA = makeEvalDataset({ id: "ds-1", name: "alpha" });
const BETA = makeEvalDataset({ id: "ds-2", name: "beta" });

describe("useEvalsWorkspace", () => {
  it("drops a deleted dataset from the list without waiting for a refetch", async () => {
    // The list endpoint keeps answering with the pre-delete state, exactly as a
    // GET racing the mutation's commit does.
    api.fetchEvalDatasets.mockResolvedValue([ALPHA, BETA]);
    const { result } = renderHook(() => useEvalsWorkspace());
    await waitFor(() => expect(result.current.datasets.data).toHaveLength(2));

    await act(async () => {
      await result.current.removeDataset("ds-1");
    });

    expect(result.current.datasets.data?.map((entry) => entry.id)).toEqual(["ds-2"]);
  });

  it("shows a generated dataset from the mutation's own response", async () => {
    api.fetchEvalDatasets.mockResolvedValue([ALPHA]);
    const generated = makeEvalDataset({ id: "ds-3", name: "generated", status: "generating" });
    api.generateEvalDataset.mockResolvedValue(generated);
    const { result } = renderHook(() => useEvalsWorkspace());
    await waitFor(() => expect(result.current.datasets.data).toHaveLength(1));

    await act(async () => {
      await result.current.generateDataset({
        collection_id: "col-1",
        name: "generated",
        models: {} as EvalDatasetGeneratePayload["models"],
        num_questions: 5,
      });
    });

    expect(result.current.datasets.data?.map((entry) => entry.id)).toEqual(["ds-3", "ds-1"]);
  });
});
