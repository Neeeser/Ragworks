import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CollectionsPage from "@/app/(console)/collections/page";
import * as apiModule from "@/lib/api";
import { makeCollection, makeCollectionStats, makeNodeSpec, makePipeline } from "@/test/fixtures";
import { resetMockAuth, setMockAuth } from "@/test/mocks";

import type { Collection, CollectionStats, NodeSpec, Pipeline } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";
const COLLECTION_COUNT_TESTID = "collection-count";
const DELETE_FIRST = "Delete first";
const CONFIRM_DELETE = "Confirm delete";
const NO_COLLECTIONS = "No collections";
const PIPELINE_FAIL = "Pipeline fail";

vi.mock("@/providers/auth-provider", async () =>
  (await import("@/test/mocks")).mockAuth({ token: "token" }),
);
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

vi.mock("@/components/collections/list/CollectionsList", () => ({
  CollectionsList: ({
    collections,
    onDeleteRequest,
  }: {
    collections: Collection[];
    onDeleteRequest: (collection: Collection) => void;
  }) => (
    <div>
      <div data-testid="collection-count">{collections.length}</div>
      <button
        type="button"
        onClick={() => {
          if (collections[0]) {
            onDeleteRequest(collections[0]);
          }
        }}
      >
        Delete first
      </button>
    </div>
  ),
}));

vi.mock("@/components/collections/list/CreateCollectionWizard", () => ({
  CreateCollectionWizard: ({
    open,
    onCreated,
    onClose,
  }: {
    open: boolean;
    onCreated: (collection: Collection) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div>
        <button
          type="button"
          onClick={() =>
            onCreated({
              id: "col-2",
              user_id: "user-1",
              name: "New",
              tools: [],
              created_at: baseTimestamp,
              updated_at: baseTimestamp,
            })
          }
        >
          Create now
        </button>
        <button type="button" onClick={onClose}>
          Close wizard
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onConfirm}>
          Confirm delete
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/notification", () => ({
  Notification: ({ message, onDismiss }: { message: string; onDismiss?: () => void }) => (
    <div>
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss}>
          Dismiss notice
        </button>
      ) : null}
    </div>
  ),
}));

describe("collections pages", () => {
  const collection = makeCollection({ name: "Collection", description: null });
  const stats = makeCollectionStats({
    collection_id: "col-1",
    document_count: 1,
    chunk_count: 2,
    average_latency_ms: null,
    last_used_at: null,
  });
  const pipeline = makePipeline({ name: "Pipe", kind: "ingestion" });
  const nodeSpec = makeNodeSpec({ type: "node", label: "Node", category: "test", description: "" });

  beforeEach(() => {
    resetMockAuth();
    api.fetchCollections.mockResolvedValue([collection]);
    api.fetchCollectionStats.mockResolvedValue([stats]);
    api.fetchPipelines.mockResolvedValue([pipeline]);
    api.fetchPipelineNodes.mockResolvedValue([nodeSpec]);
  });

  const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it("shows empty state when no token", async () => {
    setMockAuth({ token: null });
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByTestId(COLLECTION_COUNT_TESTID)).toHaveTextContent("0");
    });
  });

  it("loads collections and handles create/delete flows", async () => {
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByTestId(COLLECTION_COUNT_TESTID)).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByText("Create collection"));
    fireEvent.click(screen.getByText("Close wizard"));
    fireEvent.click(screen.getByText("Create collection"));
    fireEvent.click(screen.getByText("Create now"));
    expect(screen.getByText("Collection created.")).toBeInTheDocument();

    fireEvent.click(screen.getByText(DELETE_FIRST));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(CONFIRM_DELETE)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(DELETE_FIRST));
    fireEvent.click(screen.getByText(CONFIRM_DELETE));
    await waitFor(() => {
      expect(api.deleteCollection).toHaveBeenCalledWith("token", "col-2");
    });
    expect(screen.getByText("Collection deleted.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dismiss notice"));
    await waitFor(() => {
      expect(screen.queryByText("Collection deleted.")).not.toBeInTheDocument();
    });
  });

  it("handles collection load errors", async () => {
    api.fetchCollections.mockRejectedValueOnce(new Error(NO_COLLECTIONS));
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByText(NO_COLLECTIONS)).toBeInTheDocument();
    });
  });

  it("handles collection load errors without error objects", async () => {
    api.fetchCollections.mockRejectedValueOnce(NO_COLLECTIONS);
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load collections.")).toBeInTheDocument();
    });
  });

  it("handles pipeline load errors", async () => {
    api.fetchPipelines.mockRejectedValueOnce(new Error(PIPELINE_FAIL));
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByText(PIPELINE_FAIL)).toBeInTheDocument();
    });
  });

  it("handles pipeline load errors without error objects", async () => {
    api.fetchPipelines.mockRejectedValueOnce(PIPELINE_FAIL);
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load pipelines.")).toBeInTheDocument();
    });
  });

  it("avoids state updates after unmount", async () => {
    const collectionsDeferred = createDeferred<Collection[]>();
    const statsDeferred = createDeferred<CollectionStats[]>();
    const ingestionDeferred = createDeferred<Pipeline[]>();
    const retrievalDeferred = createDeferred<Pipeline[]>();
    const nodesDeferred = createDeferred<NodeSpec[]>();

    api.fetchCollections.mockReturnValueOnce(collectionsDeferred.promise);
    api.fetchCollectionStats.mockReturnValueOnce(statsDeferred.promise);
    api.fetchPipelines
      .mockReturnValueOnce(ingestionDeferred.promise)
      .mockReturnValueOnce(retrievalDeferred.promise);
    api.fetchPipelineNodes.mockReturnValueOnce(nodesDeferred.promise);

    const { unmount } = render(<CollectionsPage />);
    unmount();

    await act(async () => {
      collectionsDeferred.resolve([collection]);
      statsDeferred.resolve([stats]);
      ingestionDeferred.resolve([pipeline]);
      retrievalDeferred.resolve([pipeline]);
      nodesDeferred.resolve([nodeSpec]);
      await Promise.all([
        collectionsDeferred.promise,
        statsDeferred.promise,
        ingestionDeferred.promise,
        retrievalDeferred.promise,
        nodesDeferred.promise,
      ]);
    });
  });

  it("handles delete errors and missing tokens", async () => {
    api.deleteCollection.mockRejectedValueOnce("Delete failed");
    const { rerender } = render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByTestId(COLLECTION_COUNT_TESTID)).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByText(DELETE_FIRST));
    fireEvent.click(screen.getByText(CONFIRM_DELETE));

    await waitFor(() => {
      expect(screen.getByText("Unable to delete collection.")).toBeInTheDocument();
    });
    expect(api.deleteCollection).toHaveBeenCalledTimes(1);

    api.deleteCollection.mockRejectedValueOnce(new Error("Delete error"));
    fireEvent.click(screen.getByText(DELETE_FIRST));
    fireEvent.click(screen.getByText(CONFIRM_DELETE));
    await waitFor(() => {
      expect(screen.getByText("Delete error")).toBeInTheDocument();
    });
    expect(api.deleteCollection).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText(DELETE_FIRST));
    setMockAuth({ token: null });
    rerender(<CollectionsPage />);
    fireEvent.click(screen.getByText(CONFIRM_DELETE));
    expect(api.deleteCollection).toHaveBeenCalledTimes(2);
  });
});
