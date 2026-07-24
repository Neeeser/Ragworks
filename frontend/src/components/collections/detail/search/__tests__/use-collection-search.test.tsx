import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCollectionSearch } from "@/components/collections/detail/search/use-collection-search";
import * as apiModule from "@/lib/api";
import { makeCollectionTool, makeQueryResult } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

function makeInvocationResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "chunks" as const,
    tool_binding_id: "binding-1",
    outputs: {},
    ...makeQueryResult(),
    ...overrides,
  };
}

beforeEach(() => {
  api.runCollectionQuery.mockReset();
  api.invokeCollectionTool.mockReset();
  api.listCollectionTools.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("useCollectionSearch", () => {
  it("restores the last result set when the page remounts in the same tab", async () => {
    // Navigating from search results into a trace and back remounts the page;
    // the results being inspected must survive the round trip.
    api.listCollectionTools.mockResolvedValue({
      tools: [makeCollectionTool()],
      ingest_pipeline_id: null,
    });
    const response = makeInvocationResult({ query_event_id: "event-9" });
    api.invokeCollectionTool.mockResolvedValueOnce(response);

    const first = renderHook(() => useCollectionSearch("token", "col-1"));
    await act(async () => Promise.resolve());
    act(() => first.result.current.setQuery("why fusion helps"));
    await act(async () => first.result.current.run());
    expect(first.result.current.result).toEqual(response);
    first.unmount();

    const second = renderHook(() => useCollectionSearch("token", "col-1"));
    await act(async () => Promise.resolve());
    expect(second.result.current.result).toEqual(response);
    expect(second.result.current.query).toBe("why fusion helps");
    expect(api.invokeCollectionTool).toHaveBeenCalledTimes(1);
  });

  it("keeps collections' stored results separate", async () => {
    api.listCollectionTools.mockResolvedValue({
      tools: [makeCollectionTool()],
      ingest_pipeline_id: null,
    });
    api.invokeCollectionTool.mockResolvedValueOnce(makeInvocationResult());

    const first = renderHook(() => useCollectionSearch("token", "col-1"));
    await act(async () => Promise.resolve());
    act(() => first.result.current.setQuery("query"));
    await act(async () => first.result.current.run());
    first.unmount();

    const other = renderHook(() => useCollectionSearch("token", "col-2"));
    await act(async () => Promise.resolve());
    expect(other.result.current.result).toBeNull();
  });
});

describe("tool selection", () => {
  it("defaults to the primary tool and runs through its binding", async () => {
    api.listCollectionTools.mockResolvedValue({
      tools: [
        makeCollectionTool({ id: "b-secondary", name: "facet_docs", is_primary: false }),
        makeCollectionTool({ id: "b-primary", name: "search_docs", is_primary: true }),
      ],
      ingest_pipeline_id: null,
    });
    api.invokeCollectionTool.mockResolvedValueOnce(makeInvocationResult());

    const hook = renderHook(() => useCollectionSearch("token", "col-tools"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.selectedTool?.id).toBe("b-primary");

    act(() => hook.result.current.setQuery("hello"));
    await act(async () => hook.result.current.run());

    expect(api.invokeCollectionTool).toHaveBeenCalledWith(
      "token",
      "col-tools",
      "b-primary",
      expect.objectContaining({ query: "hello" }),
    );
  });

  it("switching tools swaps the argument spec and resets seeded values", async () => {
    api.listCollectionTools.mockResolvedValue({
      tools: [
        makeCollectionTool({
          id: "b-primary",
          name: "search_docs",
          is_primary: true,
          arguments: [
            {
              name: "result_limit",
              type: "integer",
              description: "",
              required: false,
              default: 5,
              minimum: 1,
              maximum: 10,
              choices: [],
              expose_to_llm: true,
            },
          ],
        }),
        makeCollectionTool({
          id: "b-facet",
          name: "facet_docs",
          is_primary: false,
          arguments: [
            {
              name: "field",
              type: "enum",
              description: "",
              required: true,
              default: "author",
              minimum: null,
              maximum: null,
              choices: ["author", "year"],
              expose_to_llm: true,
            },
          ],
        }),
      ],
      ingest_pipeline_id: null,
    });

    const hook = renderHook(() => useCollectionSearch("token", "col-switch"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.argumentValues).toEqual({ result_limit: 5 });

    act(() => hook.result.current.setSelectedToolId("b-facet"));
    await act(async () => Promise.resolve());

    expect(hook.result.current.selectedTool?.id).toBe("b-facet");
    expect(hook.result.current.argumentsSpec.map((a) => a.name)).toEqual(["field"]);
    expect(hook.result.current.argumentValues).toEqual({ field: "author" });
  });

  it("sends declared argument values through the invoke endpoint", async () => {
    api.listCollectionTools.mockResolvedValue({
      tools: [
        makeCollectionTool({
          id: "b-primary",
          is_primary: true,
          arguments: [
            {
              name: "top_k",
              type: "integer",
              description: "",
              required: false,
              default: 5,
              minimum: 1,
              maximum: 10,
              choices: [],
              expose_to_llm: true,
            },
          ],
        }),
      ],
      ingest_pipeline_id: null,
    });
    api.invokeCollectionTool.mockResolvedValueOnce(makeInvocationResult());

    const hook = renderHook(() => useCollectionSearch("token", "col-args"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.argumentValues).toEqual({ top_k: 5 });

    act(() => hook.result.current.setArgumentValue("top_k", 8));
    act(() => hook.result.current.setQuery("hello"));
    await act(async () => hook.result.current.run());

    expect(api.invokeCollectionTool).toHaveBeenCalledWith("token", "col-args", "b-primary", {
      query: "hello",
      arguments: { top_k: 8 },
    });
  });

  it("keeps the legacy top_k invoke when the tool declares nothing", async () => {
    api.listCollectionTools.mockResolvedValue({
      tools: [makeCollectionTool({ id: "b-primary", is_primary: true, arguments: [] })],
      ingest_pipeline_id: null,
    });
    api.invokeCollectionTool.mockResolvedValueOnce(makeInvocationResult());

    const hook = renderHook(() => useCollectionSearch("token", "col-legacy"));
    await act(async () => Promise.resolve());
    act(() => hook.result.current.setQuery("hello"));
    act(() => hook.result.current.setTopK(7));
    await act(async () => hook.result.current.run());

    expect(api.invokeCollectionTool).toHaveBeenCalledWith("token", "col-legacy", "b-primary", {
      query: "hello",
      top_k: 7,
    });
  });

  it("falls back to the legacy query endpoint when no tools are bound", async () => {
    api.listCollectionTools.mockResolvedValue({ tools: [], ingest_pipeline_id: null });
    api.runCollectionQuery.mockResolvedValueOnce(makeQueryResult());

    const hook = renderHook(() => useCollectionSearch("token", "col-unbound"));
    await act(async () => Promise.resolve());
    act(() => hook.result.current.setQuery("hello"));
    await act(async () => hook.result.current.run());

    expect(api.runCollectionQuery).toHaveBeenCalledWith("token", "col-unbound", {
      query: "hello",
      top_k: 5,
    });
  });

  it("exposes the tools load state instead of swallowing a failed fetch", async () => {
    // A transient failure (e.g. a token-rotation 401) must not silently render
    // the legacy control as if the collection had no tools.
    api.listCollectionTools.mockRejectedValue(new Error("boom"));

    const hook = renderHook(() => useCollectionSearch("token", "col-err"));
    expect(hook.result.current.toolsReady).toBe(false);
    await act(async () => Promise.resolve());
    expect(hook.result.current.toolsError).toBeTruthy();
    expect(hook.result.current.toolsReady).toBe(false);
  });
});
