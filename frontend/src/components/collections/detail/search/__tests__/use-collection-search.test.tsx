import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCollectionSearch } from "@/components/collections/detail/search/use-collection-search";
import * as apiModule from "@/lib/api";
import { makeQueryResult } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

describe("useCollectionSearch", () => {
  beforeEach(() => {
    api.runCollectionQuery.mockReset();
  });

  it("restores the last result set when the page remounts in the same tab", async () => {
    // Navigating from search results into a trace and back remounts the page;
    // the results being inspected must survive the round trip.
    const response = makeQueryResult({ query_event_id: "event-9" });
    api.runCollectionQuery.mockResolvedValueOnce(response);

    const first = renderHook(() => useCollectionSearch("token", "col-1"));
    act(() => first.result.current.setQuery("why fusion helps"));
    await act(async () => first.result.current.run());
    expect(first.result.current.result).toEqual(response);
    first.unmount();

    const second = renderHook(() => useCollectionSearch("token", "col-1"));
    await act(async () => Promise.resolve());
    expect(second.result.current.result).toEqual(response);
    expect(second.result.current.query).toBe("why fusion helps");
    expect(api.runCollectionQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps collections' stored results separate", async () => {
    const response = makeQueryResult();
    api.runCollectionQuery.mockResolvedValueOnce(response);

    const first = renderHook(() => useCollectionSearch("token", "col-1"));
    act(() => first.result.current.setQuery("query"));
    await act(async () => first.result.current.run());
    first.unmount();

    const other = renderHook(() => useCollectionSearch("token", "col-2"));
    await act(async () => Promise.resolve());
    expect(other.result.current.result).toBeNull();
  });
});

describe("declared pipeline arguments", () => {
  beforeEach(() => {
    api.fetchCollectionQueryArguments.mockReset();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("seeds values from declared defaults and sends the arguments map", async () => {
    api.fetchCollectionQueryArguments.mockResolvedValue({
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
        {
          name: "mode",
          type: "enum",
          description: "",
          required: false,
          default: "fast",
          minimum: null,
          maximum: null,
          choices: ["fast", "deep"],
          expose_to_llm: true,
        },
      ],
    });
    api.runCollectionQuery.mockResolvedValueOnce(makeQueryResult());

    const hook = renderHook(() => useCollectionSearch("token", "col-args"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.argumentValues).toEqual({ top_k: 5, mode: "fast" });

    act(() => hook.result.current.setArgumentValue("top_k", 8));
    act(() => hook.result.current.setQuery("hello"));
    await act(async () => hook.result.current.run());

    expect(api.runCollectionQuery).toHaveBeenCalledWith("token", "col-args", {
      query: "hello",
      arguments: { top_k: 8, mode: "fast" },
    });
  });

  it("exposes the spec load state instead of swallowing a failed fetch", async () => {
    // A transient failure (e.g. a token-rotation 401) must not silently render
    // the legacy control as if the pipeline declared nothing.
    api.fetchCollectionQueryArguments.mockRejectedValue(new Error("boom"));

    const hook = renderHook(() => useCollectionSearch("token", "col-err"));
    expect(hook.result.current.argumentsReady).toBe(false);
    await act(async () => Promise.resolve());
    expect(hook.result.current.argumentsError).toBeTruthy();
    expect(hook.result.current.argumentsReady).toBe(false);
  });

  it("reports the spec ready once it resolves", async () => {
    api.fetchCollectionQueryArguments.mockResolvedValue({ arguments: [] });

    const hook = renderHook(() => useCollectionSearch("token", "col-ready"));
    expect(hook.result.current.argumentsReady).toBe(false);
    await act(async () => Promise.resolve());
    expect(hook.result.current.argumentsReady).toBe(true);
    expect(hook.result.current.argumentsError).toBeNull();
  });

  it("keeps the legacy top_k request when the pipeline declares nothing", async () => {
    api.fetchCollectionQueryArguments.mockResolvedValue({ arguments: [] });
    api.runCollectionQuery.mockResolvedValueOnce(makeQueryResult());

    const hook = renderHook(() => useCollectionSearch("token", "col-legacy"));
    await act(async () => Promise.resolve());
    act(() => hook.result.current.setQuery("hello"));
    act(() => hook.result.current.setTopK(7));
    await act(async () => hook.result.current.run());

    expect(api.runCollectionQuery).toHaveBeenCalledWith("token", "col-legacy", {
      query: "hello",
      top_k: 7,
    });
  });
});
