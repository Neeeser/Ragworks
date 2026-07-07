"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionDocuments } from "@/components/collections/detail/CollectionDocuments";
import * as apiModule from "@/lib/api";
import { makeChunk, makeDocument, makeIngestionResponse } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const FILE_INPUT_SELECTOR = 'input[type="file"]';
const VIEW_TRACE_LABEL = "View ingestion trace";
const UPLOAD_FAILED_MESSAGE = "Upload failed.";
const makeTextFile = () => new File(["hello"], "note.txt", { type: "text/plain" });

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

const getFileInput = (root: ParentNode = window.document): HTMLInputElement => {
  const input = root.querySelector(FILE_INPUT_SELECTOR) as HTMLInputElement | null;
  if (!input) {
    throw new Error("File input not found");
  }
  return input;
};

describe("CollectionDocuments", () => {
  const doc = makeDocument({ name: "Doc" });
  const chunk = makeChunk({ metadata: { source: "doc" } });

  it("renders loading and empty states", async () => {
    api.fetchDocuments.mockImplementationOnce(() => new Promise(() => {}));
    const { container, unmount } = render(
      <CollectionDocuments collectionId="col-1" token="token" />,
    );
    // Loader is a decorative <span> with no accessible role.
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
    api.fetchDocumentChunks.mockResolvedValueOnce({ document: doc, chunks: [chunk] });

    render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Doc"));
    await waitFor(() => {
      expect(screen.getByText("Chunk text")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: VIEW_TRACE_LABEL }));
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
      expect(api.fetchDocumentTrace).toHaveBeenCalledWith("token", "doc-1");
    });
  });

  it("handles chunk and upload errors", async () => {
    api.fetchDocuments.mockResolvedValueOnce([doc]);
    api.fetchDocumentChunks.mockRejectedValueOnce(new Error("Chunk error"));
    api.uploadDocument.mockRejectedValueOnce(new Error(UPLOAD_FAILED_MESSAGE));
    api.fetchDocuments.mockResolvedValueOnce([doc]);

    render(<CollectionDocuments collectionId="col-1" token="token" />);

    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Doc"));
    await waitFor(() => {
      expect(screen.getByText("Chunk error")).toBeInTheDocument();
    });

    const fileInput = getFileInput();
    const file = makeTextFile();
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(screen.getByText(UPLOAD_FAILED_MESSAGE)).toBeInTheDocument();
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

    const fileInput = getFileInput(container);
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
    api.fetchDocumentChunks.mockResolvedValueOnce({ document: doc, chunks: [] });
    api.fetchDocumentTrace.mockRejectedValueOnce("no trace");

    render(<CollectionDocuments collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Doc"));
    fireEvent.click(screen.getByRole("button", { name: VIEW_TRACE_LABEL }));
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
    api.fetchDocumentChunks.mockResolvedValueOnce({ document: doc, chunks: [] });
    api.fetchDocumentTrace.mockRejectedValueOnce(new Error("Trace boom"));

    render(<CollectionDocuments collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Doc"));
    fireEvent.click(screen.getByRole("button", { name: VIEW_TRACE_LABEL }));
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

    fireEvent.click(screen.getByRole("button", { name: VIEW_TRACE_LABEL }));
    await waitFor(() => {
      expect(screen.getByText("Unable to load trace.")).toBeInTheDocument();
    });

    const fileInput = getFileInput();
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(api.uploadDocument).not.toHaveBeenCalled();

    const file = makeTextFile();
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(screen.getByText(UPLOAD_FAILED_MESSAGE)).toBeInTheDocument();
    });
  });

  it("uploads documents and refreshes the list", async () => {
    api.fetchDocuments.mockResolvedValueOnce([doc]);
    api.uploadDocument.mockResolvedValueOnce(makeIngestionResponse());
    api.fetchDocuments.mockResolvedValueOnce([doc]);

    render(<CollectionDocuments collectionId="col-1" token="token" />);
    await waitFor(() => {
      expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    const fileInput = getFileInput();
    const file = makeTextFile();
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText("Uploaded note.txt. Chunking in progress.")).toBeInTheDocument();
    });
    expect(fileInput.value).toBe("");
  });
});
