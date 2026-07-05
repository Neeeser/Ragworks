import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useApiQuery } from "@/lib/use-api-query";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useApiQuery", () => {
  it("resolves data and clears loading", async () => {
    const fn = vi.fn().mockResolvedValue({ value: 42 });
    const { result } = renderHook(() => useApiQuery(fn, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("sets an error message via getErrorMessage on rejection", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useApiQuery(fn, []));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a default error message for non-Error rejections", async () => {
    const fn = vi.fn().mockRejectedValue("nope");
    const { result } = renderHook(() => useApiQuery(fn, []));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Something went wrong");
  });

  it("ignores a stale resolution after deps change", async () => {
    const secondResult = "second-result";
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ dep }) => useApiQuery(fn, [dep]), {
      initialProps: { dep: 1 },
    });

    rerender({ dep: 2 });

    // Resolve the second (current) request first, then the stale first one.
    // `await act(async () => ...)` flushes both the promise callbacks and any
    // React work they schedule, so an unguarded stale setData would be visible.
    await act(async () => {
      second.resolve(secondResult);
    });
    expect(result.current.data).toBe(secondResult);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      first.resolve("first-result-stale");
    });

    expect(result.current.data).toBe(secondResult);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale rejection after deps change", async () => {
    const currentResult = "current-result";
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ dep }) => useApiQuery(fn, [dep]), {
      initialProps: { dep: 1 },
    });

    rerender({ dep: 2 });

    await act(async () => {
      second.resolve(currentResult);
    });
    expect(result.current.data).toBe(currentResult);

    await act(async () => {
      first.reject(new Error("stale failure"));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe(currentResult);
  });

  it("refetches when reload is called", async () => {
    const fn = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const { result } = renderHook(() => useApiQuery(fn, []));

    await waitFor(() => expect(result.current.data).toBe("first"));

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.data).toBe("second"));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when enabled is false, and resets data/error/loading", async () => {
    const fn = vi.fn().mockResolvedValue("value");
    const { result, rerender } = renderHook(({ enabled }) => useApiQuery(fn, [], { enabled }), {
      initialProps: { enabled: true },
    });

    await waitFor(() => expect(result.current.data).toBe("value"));

    rerender({ enabled: false });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
