"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionDocuments } from "@/components/collections/detail/CollectionDocuments";

import type { Chunk, Document } from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

const api = {
  fetchDocuments: vi.fn(),
  fetchDocumentChunks: vi.fn(),
  fetchDocumentTrace: vi.fn(),
  uploadDocument: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  fetchDocuments: (...args: unknown[]) => api.fetchDocuments(...args),
  fetchDocumentChunks: (...args: unknown[]) => api.fetchDocumentChunks(...args),
  fetchDocumentTrace: (...args: unknown[]) => api.fetchDocumentTrace(...args),
  uploadDocument: (...args: unknown[]) => api.uploadDocument(...args),
}));

vi.mock("@/components/traces/PipelineTraceViewer", () => ({
  PipelineTraceViewer: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="trace-viewer">
        <button type="button" onClick={onClose}>
          Close trace
        </button>
      </div>
    ) : null,
}));

describe("CollectionDocuments", () => {
  const doc: Document = {
    id: "doc-1",
    collection_id: "col-1",
    name: "Doc",
    content_type: "text/plain",
    status: "ready",
    num_chunks: 1,
    num_tokens: 10,
    chunk_size: 256,
    chunk_overlap: 0,
    chunk_strategy: "token",
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  };
  const chunk: Chunk = {
    id: "chunk-1",
    document_id: "doc-1",
    chunk_index: 0,
    text: "Chunk text",
    metadata: { source: "doc" },
    chunk_size: 256,
    chunk_strategy: "token",
    created_at: baseTimestamp,
  };

  it("renders loading and empty states", async () => {
    api.fetchDocuments.mockImplementationOnce(() => new Promise(() => {}));
    const { container, unmount } = render(
      <CollectionDocuments collectionId="col-1" token="token" />,
    );
    expect(container.querySelector("span")).toBeInTheDocument();
    await waitFor(() => {
      expect(api.fetchDocuments).toHaveBeenCalledTimes(1);
    });

    unmount();
    api.fetchDocuments.mockResolvedValueOnce([]);
    render(<CollectionDocuments collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(
        screen.getByText("No documents yet. Upload a file to start chunking."),
      ).toBeInTheDocument();
    });
  });

  it("expands documents, loads chunks, and opens trace", async () => {
    api.fetchDocuments.mockResolvedValueOnce([{ ...doc, ingestion_run_id: "run-123" }]);
    api.fetchDocumentChunks.mockResolvedValueOnce({ chunks: [chunk] });
    api.fetchDocumentTrace.mockResolvedValueOnce({ run: { id: "run-1" } });

    render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Doc"));
    await waitFor(() => {
      expect(screen.getByText("Chunk text")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View ingestion trace" }));
    await waitFor(() => {
      expect(screen.getByTestId("trace-viewer")).toBeInTheDocument();
    });
    expect(screen.getByText(/Trace run: run-123/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close trace" }));
    await waitFor(() => {
      expect(screen.queryByTestId("trace-viewer")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Chunk #/));
    fireEvent.click(screen.getByRole("button", { name: "Trace this chunk" }));
    await waitFor(() => {
      expect(api.fetchDocumentTrace).toHaveBeenCalledWith("doc-1", "token");
    });
  });

  it("handles chunk and upload errors", async () => {
    api.fetchDocuments.mockResolvedValueOnce([doc]);
    api.fetchDocumentChunks.mockRejectedValueOnce(new Error("Chunk error"));
    api.uploadDocument.mockRejectedValueOnce(new Error("Upload failed."));
    api.fetchDocuments.mockResolvedValueOnce([doc]);

    render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Doc"));
    await waitFor(() => {
      expect(screen.getByText("Chunk error")).toBeInTheDocument();
    });

    const fileInput = window.document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    if (!fileInput) {
      throw new Error("File input not found");
    }
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(screen.getByText("Upload failed.")).toBeInTheDocument();
    });
  });

  it("triggers the hidden upload input from the action button", async () => {
    api.fetchDocuments.mockResolvedValueOnce([]);
    const { container } = render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(
        screen.getByText("No documents yet. Upload a file to start chunking."),
      ).toBeInTheDocument();
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) {
      throw new Error("Expected file input to be rendered");
    }
    const clickSpy = vi.spyOn(fileInput, "click");

    fireEvent.click(screen.getByRole("button", { name: "Upload document" }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("handles document load and trace errors", async () => {
    api.fetchDocuments.mockRejectedValueOnce("bad docs");
    const { unmount } = render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load documents.")).toBeInTheDocument();
    });

    unmount();
    api.fetchDocuments.mockResolvedValueOnce([doc]);
    api.fetchDocumentChunks.mockResolvedValueOnce({ chunks: [] });
    api.fetchDocumentTrace.mockRejectedValueOnce("no trace");

    render(<CollectionDocuments collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Doc"));
    fireEvent.click(screen.getByRole("button", { name: "View ingestion trace" }));
    await waitFor(() => {
      expect(screen.getByText("Unable to load trace.")).toBeInTheDocument();
    });
  });

  it("uses error messages from thrown errors", async () => {
    api.fetchDocuments.mockRejectedValueOnce(new Error("Boom"));
    const { unmount } = render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Boom")).toBeInTheDocument();
    });

    unmount();
    api.fetchDocuments.mockResolvedValueOnce([doc]);
    api.fetchDocumentChunks.mockResolvedValueOnce({ chunks: [] });
    api.fetchDocumentTrace.mockRejectedValueOnce(new Error("Trace boom"));

    render(<CollectionDocuments collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Doc"));
    fireEvent.click(screen.getByRole("button", { name: "View ingestion trace" }));
    await waitFor(() => {
      expect(screen.getByText("Trace boom")).toBeInTheDocument();
    });
  });

  it("handles non-error chunk, trace, and upload failures", async () => {
    api.fetchDocuments.mockResolvedValueOnce([doc]);
    api.fetchDocumentChunks.mockRejectedValueOnce("chunk fail");
    api.fetchDocumentTrace.mockRejectedValueOnce("trace fail");
    api.uploadDocument.mockRejectedValueOnce("upload fail");

    render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Doc"));
    await waitFor(() => {
      expect(screen.getByText("Unable to load chunks.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View ingestion trace" }));
    await waitFor(() => {
      expect(screen.getByText("Unable to load trace.")).toBeInTheDocument();
    });

    const fileInput = window.document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    if (!fileInput) {
      throw new Error("File input not found");
    }
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(api.uploadDocument).not.toHaveBeenCalled();

    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(screen.getByText("Upload failed.")).toBeInTheDocument();
    });
  });

  it("uploads documents and refreshes the list", async () => {
    api.fetchDocuments.mockResolvedValueOnce([doc]);
    api.uploadDocument.mockResolvedValueOnce(undefined);
    api.fetchDocuments.mockResolvedValueOnce([doc]);

    render(<CollectionDocuments collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    const fileInput = window.document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    if (!fileInput) {
      throw new Error("File input not found");
    }
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText("Uploaded note.txt. Chunking in progress.")).toBeInTheDocument();
    });
    expect(fileInput.value).toBe("");
  });
});
