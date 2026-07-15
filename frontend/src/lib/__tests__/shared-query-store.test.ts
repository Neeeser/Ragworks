import { describe, expect, it, vi } from "vitest";

import { SharedQueryStore } from "@/lib/shared-query-store";

const USER_CHAT_KEY = "user-1:chat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SharedQueryStore", () => {
  it("returns stable snapshots until state changes", () => {
    const store = new SharedQueryStore<string, string>((key) => key);

    expect(store.snapshot("chat")).toBe(store.snapshot("chat"));
    store.invalidate((key) => key === "chat");
    expect(store.snapshot("chat").invalidated).toBe(true);
  });

  it("deduplicates requests and retains data during revalidation", async () => {
    const store = new SharedQueryStore<string, string>((key) => key);
    const first = deferred<string>();
    const loader = vi.fn(() => first.promise);

    const one = store.revalidate("chat", loader);
    const two = store.revalidate("chat", loader);
    expect(one).toBe(two);
    expect(store.snapshot("chat").loading).toBe(true);

    first.resolve("one");
    await one;
    expect(store.snapshot("chat").data).toBe("one");

    const second = deferred<string>();
    const refresh = store.revalidate("chat", () => second.promise);
    expect(store.snapshot("chat")).toMatchObject({ data: "one", loading: true });
    second.resolve("two");
    await refresh;
    expect(store.snapshot("chat")).toMatchObject({ data: "two", loading: false });
  });

  it("publishes errors without discarding retained data", async () => {
    const store = new SharedQueryStore<string, string>((key) => key);
    await store.revalidate("chat", async () => "retained");

    await expect(
      store.revalidate("chat", async () => {
        throw new Error("offline");
      }),
    ).resolves.toBeUndefined();

    expect(store.snapshot("chat")).toMatchObject({
      data: "retained",
      loading: false,
      error: "offline",
    });
  });

  it("notifies subscribers on invalidation and removes user entries", async () => {
    const store = new SharedQueryStore<string, string>((key) => key);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(USER_CHAT_KEY, listener);
    await store.revalidate(USER_CHAT_KEY, async () => "models");
    listener.mockClear();

    store.invalidate((key) => key.startsWith("user-1:"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.snapshot(USER_CHAT_KEY).invalidated).toBe(true);

    unsubscribe();
    store.removeMatching((key) => key.startsWith("user-1:"));
    expect(store.has(USER_CHAT_KEY)).toBe(false);
  });

  it("ignores a late response after an entry is removed", async () => {
    const store = new SharedQueryStore<string, string>((key) => key);
    const request = deferred<string>();
    const pending = store.revalidate(USER_CHAT_KEY, () => request.promise);

    store.removeMatching((key) => key.startsWith("user-1:"));
    request.resolve("private models");
    await pending;

    expect(store.snapshot(USER_CHAT_KEY).data).toBeNull();
  });
});
