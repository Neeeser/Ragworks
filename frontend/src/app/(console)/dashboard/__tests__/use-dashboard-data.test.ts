import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardData } from "@/app/(console)/dashboard/use-dashboard-data";
import * as apiModule from "@/lib/api";
import { makeCollection, makeDocument } from "@/test/fixtures";
import { resetMockAuth, setMockAuth } from "@/test/mocks";

import type { Collection, Document } from "@/lib/types";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const collections: Collection[] = [
  makeCollection({
    id: "col-1",
    name: "One",
    tools: [
      { id: "binding-1", pipeline_id: "pipe-1", is_primary: true, enabled: true, position: 0 },
    ],
  }),
  makeCollection({
    id: "col-2",
    name: "Two",
    tools: [
      { id: "binding-1", pipeline_id: "pipe-2", is_primary: true, enabled: true, position: 0 },
    ],
  }),
];

const docFor = (collectionId: string): Document =>
  makeDocument({
    id: `doc-${collectionId}`,
    collection_id: collectionId,
    name: `Doc ${collectionId}`,
    content_type: "text/plain",
    num_chunks: 2,
    num_tokens: 50,
    chunk_size: 250,
    chunk_overlap: 0,
  });

describe("useDashboardData", () => {
  beforeEach(() => {
    resetMockAuth();
  });

  it("tolerates one collection's document fetch failing without sinking the dashboard", async () => {
    api.fetchCollections.mockResolvedValue(collections);
    api.fetchDocuments.mockImplementation((_token: string, collectionId: string) => {
      if (collectionId === "col-1") {
        return Promise.reject(new Error("index unavailable"));
      }
      return Promise.resolve([docFor(collectionId)]);
    });

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.collections).toEqual(collections);
    // col-1 failed and contributed no documents; col-2 still contributed its document.
    expect(result.current.stats.docCount).toBe(1);
    expect(result.current.recentDocuments).toHaveLength(1);
    expect(result.current.recentDocuments[0].collection_id).toBe("col-2");
  });

  it("fetches per-collection documents in parallel rather than one at a time", async () => {
    api.fetchCollections.mockResolvedValue(collections);
    const releases: Array<() => void> = [];
    api.fetchDocuments.mockImplementation(
      (_token: string, collectionId: string) =>
        new Promise((resolve) => {
          releases.push(() => resolve([docFor(collectionId)]));
        }),
    );

    renderHook(() => useDashboardData());

    // Both fetches must have been issued before either resolves - if they ran
    // serially, the second call would not exist yet at this point.
    await waitFor(() => expect(api.fetchDocuments).toHaveBeenCalledTimes(collections.length));
    await act(async () => {
      releases.forEach((release) => release());
      await Promise.resolve();
    });
  });

  it("tolerates the chat sessions fetch failing", async () => {
    api.fetchCollections.mockResolvedValue([]);
    api.listChatSessions.mockRejectedValueOnce(new Error("sessions down"));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.sessions).toEqual([]);
  });

  it("surfaces a top-level error when the initial collections fetch fails", async () => {
    api.fetchCollections.mockRejectedValueOnce(new Error("Load failed"));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Load failed");
  });

  it("does nothing when there is no auth token", () => {
    setMockAuth({ token: null });
    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);
    expect(api.fetchCollections).not.toHaveBeenCalled();
  });
});
