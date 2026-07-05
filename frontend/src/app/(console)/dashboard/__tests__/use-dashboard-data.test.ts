import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardData } from "@/app/(console)/dashboard/use-dashboard-data";

import type { Collection, Document } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

const api = {
  fetchCollections: vi.fn(),
  fetchDocuments: vi.fn(),
  fetchPipelines: vi.fn(),
  listChatSessions: vi.fn(),
};

let mockToken: string | null = "token";

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ token: mockToken }),
}));

vi.mock("@/lib/api", () => ({
  fetchCollections: (...args: unknown[]) => api.fetchCollections(...args),
  fetchDocuments: (...args: unknown[]) => api.fetchDocuments(...args),
  fetchPipelines: (...args: unknown[]) => api.fetchPipelines(...args),
  listChatSessions: (...args: unknown[]) => api.listChatSessions(...args),
}));

const collections: Collection[] = [
  {
    id: "col-1",
    user_id: "user-1",
    name: "One",
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    retrieval_pipeline_id: "pipe-1",
  },
  {
    id: "col-2",
    user_id: "user-1",
    name: "Two",
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    retrieval_pipeline_id: "pipe-2",
  },
];

const docFor = (collectionId: string): Document => ({
  id: `doc-${collectionId}`,
  collection_id: collectionId,
  name: `Doc ${collectionId}`,
  content_type: "text/plain",
  status: "ready",
  num_chunks: 2,
  num_tokens: 50,
  chunk_size: 250,
  chunk_overlap: 0,
  chunk_strategy: "token",
  created_at: baseTimestamp,
  updated_at: baseTimestamp,
});

describe("useDashboardData", () => {
  beforeEach(() => {
    mockToken = "token";
    api.fetchCollections.mockReset();
    api.fetchDocuments.mockReset();
    api.fetchPipelines.mockReset();
    api.listChatSessions.mockReset();
    api.fetchPipelines.mockResolvedValue([]);
    api.listChatSessions.mockResolvedValue([]);
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
    mockToken = null;
    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);
    expect(api.fetchCollections).not.toHaveBeenCalled();
  });
});
