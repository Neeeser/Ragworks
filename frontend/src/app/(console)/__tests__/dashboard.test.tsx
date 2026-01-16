import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(console)/dashboard/page";

import type { ChatSession, Collection, Document, Pipeline, User } from "@/lib/types";

const api = {
  fetchCollections: vi.fn(),
  fetchDocuments: vi.fn(),
  fetchPipelines: vi.fn(),
  listChatSessions: vi.fn(),
};

const baseTimestamp = "2024-01-01T00:00:00.000Z";
const docTimestamp = "2024-01-02T00:00:00.000Z";

let mockAuth: { token: string | null; user: User | null } = {
  token: "token",
  user: {
    id: "user-1",
    email: "user@example.com",
    is_active: true,
    openrouter_configured: true,
    pinecone_configured: true,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  },
};

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/lib/api", () => ({
  fetchCollections: (...args: unknown[]) => api.fetchCollections(...args),
  fetchDocuments: (...args: unknown[]) => api.fetchDocuments(...args),
  fetchPipelines: (...args: unknown[]) => api.fetchPipelines(...args),
  listChatSessions: (...args: unknown[]) => api.listChatSessions(...args),
}));

describe("DashboardPage", () => {
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
  const docs: Document[] = [
    {
      id: "doc-1",
      collection_id: "col-1",
      name: "Doc",
      content_type: "text/plain",
      status: "ready",
      num_chunks: 2,
      num_tokens: 50,
      chunk_size: 250,
      chunk_overlap: 0,
      chunk_strategy: "token",
      created_at: docTimestamp,
      updated_at: docTimestamp,
    },
  ];
  const pipelines: Pipeline[] = [
    {
      id: "pipe-1",
      user_id: "user-1",
      name: "Retrieval",
      kind: "retrieval",
      current_version: 1,
      is_default: true,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: {
        nodes: [
          { id: "node-1", type: "chat.settings", name: "Settings", config: { context_window: 64 } },
        ],
        edges: [],
      },
    },
  ];
  const sessions: ChatSession[] = [
    {
      id: "session-1",
      user_id: "user-1",
      title: "Session",
      mode: "chat",
      chat_model: "model",
      context_tokens: 32,
      tool_collection_ids: [],
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
    },
  ];

  beforeEach(() => {
    mockAuth = { ...mockAuth, token: "token" };
    api.fetchCollections.mockReset();
    api.fetchDocuments.mockReset();
    api.fetchPipelines.mockReset();
    api.listChatSessions.mockReset();
    api.fetchCollections.mockResolvedValue(collections);
    api.fetchPipelines.mockResolvedValue(pipelines);
    api.fetchDocuments.mockResolvedValue(docs);
    api.listChatSessions.mockResolvedValue(sessions);
  });

  const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it("shows loader when token is missing", () => {
    mockAuth = { ...mockAuth, token: null };
    const { container } = render(<DashboardPage />);
    expect(container.querySelector("span.animate-spin")).toBeInTheDocument();
  });

  it("loads dashboard metrics and handles document errors", async () => {
    api.fetchDocuments.mockRejectedValueOnce(new Error("Doc fail"));
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Collections live")).toBeInTheDocument();
    });
    expect(screen.getByText(/Hello .*telemetry/)).toBeInTheDocument();
  });

  it("handles session fetch errors", async () => {
    api.listChatSessions.mockRejectedValueOnce(new Error("Session fail"));
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Chat sessions")).toBeInTheDocument();
    });
  });

  it("renders empty states when there is no data", async () => {
    api.fetchCollections.mockResolvedValueOnce([]);
    api.fetchPipelines.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    api.fetchDocuments.mockResolvedValueOnce([]);
    api.listChatSessions.mockResolvedValueOnce([]);
    render(<DashboardPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No documents yet. Upload your first source from the collections page."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Create your first collection to begin.")).toBeInTheDocument();
  });

  it("shows error state on load failure", async () => {
    api.fetchCollections.mockRejectedValueOnce(new Error("Load failed"));
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Load failed")).toBeInTheDocument();
    });
  });

  it("shows error state on load failure without error objects", async () => {
    api.fetchCollections.mockRejectedValueOnce("Load failed");
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load data.")).toBeInTheDocument();
    });
  });

  it("handles missing chat settings in pipelines", async () => {
    const pipelineWithoutSettings = [
      {
        ...pipelines[0],
        definition: { nodes: [{ id: "node-1", type: "other", config: {} }], edges: [] },
      },
    ];
    api.fetchPipelines
      .mockResolvedValueOnce(pipelineWithoutSettings)
      .mockResolvedValueOnce(pipelineWithoutSettings);
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Collections live")).toBeInTheDocument();
    });
    expect(screen.getByText("0% context utilization")).toBeInTheDocument();
  });

  it("falls back when retrieval pipeline names are missing", async () => {
    api.fetchCollections.mockResolvedValueOnce([
      {
        ...collections[0],
        retrieval_pipeline_id: null,
      },
    ]);
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Collections live")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Retrieval pipeline").length).toBeGreaterThan(0);
  });

  it("avoids state updates after unmount", async () => {
    const collectionsDeferred = createDeferred<Collection[]>();
    const ingestionDeferred = createDeferred<Pipeline[]>();
    const retrievalDeferred = createDeferred<Pipeline[]>();

    api.fetchCollections.mockReturnValueOnce(collectionsDeferred.promise);
    api.fetchPipelines
      .mockReturnValueOnce(ingestionDeferred.promise)
      .mockReturnValueOnce(retrievalDeferred.promise);

    const { unmount } = render(<DashboardPage />);
    unmount();

    await act(async () => {
      collectionsDeferred.resolve(collections);
      ingestionDeferred.resolve([]);
      retrievalDeferred.resolve([]);
      await Promise.all([
        collectionsDeferred.promise,
        ingestionDeferred.promise,
        retrievalDeferred.promise,
      ]);
    });
  });

  it("avoids state updates after unmount during document loads", async () => {
    const collectionsDeferred = createDeferred<Collection[]>();
    const ingestionDeferred = createDeferred<Pipeline[]>();
    const retrievalDeferred = createDeferred<Pipeline[]>();
    const documentsDeferred = createDeferred<Document[]>();

    api.fetchCollections.mockReturnValueOnce(collectionsDeferred.promise);
    api.fetchPipelines
      .mockReturnValueOnce(ingestionDeferred.promise)
      .mockReturnValueOnce(retrievalDeferred.promise);
    api.fetchDocuments.mockReturnValueOnce(documentsDeferred.promise);

    const { unmount } = render(<DashboardPage />);

    await act(async () => {
      collectionsDeferred.resolve(collections.slice(0, 1));
      ingestionDeferred.resolve([]);
      retrievalDeferred.resolve([]);
      await Promise.all([
        collectionsDeferred.promise,
        ingestionDeferred.promise,
        retrievalDeferred.promise,
      ]);
    });

    unmount();

    await act(async () => {
      documentsDeferred.resolve([]);
      await documentsDeferred.promise;
    });
  });
});
