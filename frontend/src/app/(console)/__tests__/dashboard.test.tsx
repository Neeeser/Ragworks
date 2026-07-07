import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(console)/dashboard/page";
import * as apiModule from "@/lib/api";
import { makeChatSession, makeCollection, makeDocument, makePipeline } from "@/test/fixtures";
import { resetMockAuth, setMockAuth } from "@/test/mocks";

import type { Collection, Document, Pipeline } from "@/lib/types";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const COLLECTIONS_LIVE = "Collections live";
const LOAD_FAILED = "Load failed";

describe("DashboardPage", () => {
  const collections: Collection[] = [
    makeCollection({
      id: "col-1",
      name: "One",
      description: null,
      retrieval_pipeline_id: "pipe-1",
    }),
    makeCollection({
      id: "col-2",
      name: "Two",
      description: null,
      retrieval_pipeline_id: "pipe-2",
    }),
  ];
  const docs: Document[] = [
    makeDocument({
      id: "doc-1",
      name: "Doc",
      content_type: "text/plain",
      num_chunks: 2,
      num_tokens: 50,
      chunk_size: 250,
      chunk_overlap: 0,
      ingestion_run_id: null,
    }),
  ];
  const pipelines: Pipeline[] = [
    makePipeline({
      id: "pipe-1",
      is_default: true,
      definition: {
        nodes: [
          { id: "node-1", type: "chat.settings", name: "Settings", config: { context_window: 64 } },
        ],
        edges: [],
      },
    }),
  ];
  const sessions = [
    makeChatSession({ id: "session-1", title: "Session", tool_collection_ids: [] }),
  ];

  beforeEach(() => {
    resetMockAuth();
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

  it("renders the loading state, not dashboard content, when the token is missing", () => {
    setMockAuth({ token: null, user: null });
    const { container } = render(<DashboardPage />);
    // The Loader spinner exposes no role/text; span presence is the only handle.
    expect(container.querySelector("span")).toBeInTheDocument();
    expect(screen.queryByText(COLLECTIONS_LIVE)).not.toBeInTheDocument();
  });

  it("loads dashboard metrics and handles document errors", async () => {
    api.fetchDocuments.mockRejectedValueOnce(new Error("Doc fail"));
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(COLLECTIONS_LIVE)).toBeInTheDocument();
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
    api.fetchCollections.mockRejectedValueOnce(new Error(LOAD_FAILED));
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();
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
      makePipeline({
        definition: {
          nodes: [{ id: "node-1", type: "other", name: "Other", config: {} }],
          edges: [],
        },
      }),
    ];
    api.fetchPipelines
      .mockResolvedValueOnce(pipelineWithoutSettings)
      .mockResolvedValueOnce(pipelineWithoutSettings);
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(COLLECTIONS_LIVE)).toBeInTheDocument();
    });
    expect(screen.getByText("0% context utilization")).toBeInTheDocument();
  });

  it("falls back when retrieval pipeline names are missing", async () => {
    api.fetchCollections.mockResolvedValueOnce([
      makeCollection({ id: "col-1", name: "One", retrieval_pipeline_id: null }),
    ]);
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(COLLECTIONS_LIVE)).toBeInTheDocument();
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
