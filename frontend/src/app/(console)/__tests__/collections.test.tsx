import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CollectionDetailPage from "@/app/(console)/collections/[collectionId]/page";
import CollectionsPage from "@/app/(console)/collections/page";
import { setMockParams } from "@/test/test-utils";

import type { Collection, CollectionStats, NodeSpec, Pipeline } from "@/lib/types";

const api = {
  deleteCollection: vi.fn(),
  fetchCollectionStats: vi.fn(),
  fetchCollections: vi.fn(),
  fetchPipelineNodes: vi.fn(),
  fetchPipelines: vi.fn(),
};

let mockToken: string | null = "token";
const baseTimestamp = "2024-01-01T00:00:00.000Z";

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ token: mockToken }),
}));

vi.mock("@/lib/api", () => ({
  deleteCollection: (...args: unknown[]) => api.deleteCollection(...args),
  fetchCollectionStats: (...args: unknown[]) => api.fetchCollectionStats(...args),
  fetchCollections: (...args: unknown[]) => api.fetchCollections(...args),
  fetchPipelineNodes: (...args: unknown[]) => api.fetchPipelineNodes(...args),
  fetchPipelines: (...args: unknown[]) => api.fetchPipelines(...args),
}));

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

vi.mock("@/components/collections/detail/CollectionDetail", () => ({
  CollectionDetail: ({ collectionId }: { collectionId: string }) => (
    <div data-testid="collection-detail">{collectionId}</div>
  ),
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
  const collection: Collection = {
    id: "col-1",
    user_id: "user-1",
    name: "Collection",
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  };
  const stats: CollectionStats = {
    collection_id: "col-1",
    document_count: 1,
    chunk_count: 2,
    average_latency_ms: null,
    last_used_at: null,
  };
  const pipeline: Pipeline = {
    id: "pipe-1",
    user_id: "user-1",
    name: "Pipe",
    kind: "ingestion",
    current_version: 1,
    is_default: false,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    definition: { nodes: [], edges: [] },
  };
  const nodeSpec: NodeSpec = {
    type: "node",
    label: "Node",
    description: "",
    input_ports: [],
    output_ports: [],
  };

  beforeEach(() => {
    mockToken = "token";
    api.deleteCollection.mockReset();
    api.fetchCollectionStats.mockReset();
    api.fetchCollections.mockReset();
    api.fetchPipelineNodes.mockReset();
    api.fetchPipelines.mockReset();
    api.fetchCollections.mockResolvedValue([collection]);
    api.fetchCollectionStats.mockResolvedValue([stats]);
    api.fetchPipelines.mockResolvedValue([pipeline]);
    api.fetchPipelineNodes.mockResolvedValue([nodeSpec]);
    api.deleteCollection.mockResolvedValue({ status: "ok" });
  });

  const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it("shows empty state when no token", async () => {
    mockToken = null;
    const { rerender } = render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("collection-count")).toHaveTextContent("0");
    });
  });

  it("loads collections and handles create/delete flows", async () => {
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("collection-count")).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByText("Create collection"));
    fireEvent.click(screen.getByText("Close wizard"));
    fireEvent.click(screen.getByText("Create collection"));
    fireEvent.click(screen.getByText("Create now"));
    expect(screen.getByText("Collection created.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Delete first"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Confirm delete")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Delete first"));
    fireEvent.click(screen.getByText("Confirm delete"));
    await waitFor(() => {
      expect(api.deleteCollection).toHaveBeenCalledWith("col-2", "token");
    });
    expect(screen.getByText("Collection deleted.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dismiss notice"));
    await waitFor(() => {
      expect(screen.queryByText("Collection deleted.")).not.toBeInTheDocument();
    });
  });

  it("handles collection load errors", async () => {
    api.fetchCollections.mockRejectedValueOnce(new Error("No collections"));
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByText("No collections")).toBeInTheDocument();
    });
  });

  it("handles collection load errors without error objects", async () => {
    api.fetchCollections.mockRejectedValueOnce("No collections");
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load collections.")).toBeInTheDocument();
    });
  });

  it("handles pipeline load errors", async () => {
    api.fetchPipelines.mockRejectedValueOnce(new Error("Pipeline fail"));
    render(<CollectionsPage />);

    await waitFor(() => {
      expect(screen.getByText("Pipeline fail")).toBeInTheDocument();
    });
  });

  it("handles pipeline load errors without error objects", async () => {
    api.fetchPipelines.mockRejectedValueOnce("Pipeline fail");
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
      expect(screen.getByTestId("collection-count")).toHaveTextContent("1");
    });

    fireEvent.click(screen.getByText("Delete first"));
    fireEvent.click(screen.getByText("Confirm delete"));

    await waitFor(() => {
      expect(screen.getByText("Unable to delete collection.")).toBeInTheDocument();
    });
    expect(api.deleteCollection).toHaveBeenCalledTimes(1);

    api.deleteCollection.mockRejectedValueOnce(new Error("Delete error"));
    fireEvent.click(screen.getByText("Delete first"));
    fireEvent.click(screen.getByText("Confirm delete"));
    await waitFor(() => {
      expect(screen.getByText("Delete error")).toBeInTheDocument();
    });
    expect(api.deleteCollection).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("Delete first"));
    mockToken = null;
    rerender(<CollectionsPage />);
    fireEvent.click(screen.getByText("Confirm delete"));
    expect(api.deleteCollection).toHaveBeenCalledTimes(2);
  });

  it("renders collection detail page with params", () => {
    setMockParams({ collectionId: "col-99" });
    render(<CollectionDetailPage />);
    expect(screen.getByTestId("collection-detail")).toHaveTextContent("col-99");
  });
});
