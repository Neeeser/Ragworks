import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FileRowDetails } from "@/components/files/FileRowDetails";
import * as apiModule from "@/lib/api";
import { makeChunk, makeChunkVisualization, makeFileNode } from "@/test/fixtures";

import type { FileIngestion } from "@/lib/types";

const routerPush = vi.fn();

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
}));

const api = vi.mocked(apiModule);

const ingestion: FileIngestion = {
  document_id: "doc-9",
  status: "ready",
  warnings: [],
  num_chunks: 1,
  num_tokens: 10,
  chunk_size: 512,
  chunk_overlap: 20,
  chunk_strategy: "token",
  embedding_model: "all-minilm",
  ingestion_run_id: "run-1",
  updated_at: "2026-07-15T00:00:00Z",
};

describe("FileRowDetails", () => {
  it("sorts expanded chunks by number by default and exposes the trace with metadata", async () => {
    const user = userEvent.setup();
    api.fetchDocumentChunks.mockResolvedValueOnce(
      makeChunkVisualization({
        chunks: [
          makeChunk({ id: "chunk-2", chunk_index: 2, token_count: 30 }),
          makeChunk({ id: "chunk-0", chunk_index: 0, token_count: 10 }),
          makeChunk({ id: "chunk-1", chunk_index: 1, token_count: 20 }),
        ],
      }),
    );

    render(<FileRowDetails node={makeFileNode()} ingestion={ingestion} token="token" />);
    await waitFor(() => expect(screen.getByText(/Chunk 00/)).toBeInTheDocument());

    expect(screen.getByText("Trace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View ingestion trace" })).toBeInTheDocument();
    expect(screen.getAllByText(/Chunk \d{2}/).map((item) => item.textContent)).toEqual([
      "Chunk 00",
      "Chunk 01",
      "Chunk 02",
    ]);

    await user.click(screen.getByRole("combobox", { name: "Sort chunks" }));
    await user.click(screen.getByRole("option", { name: "Tokens" }));
    await user.click(screen.getByRole("button", { name: "Sort descending" }));

    expect(screen.getAllByText(/Chunk \d{2}/).map((item) => item.textContent)).toEqual([
      "Chunk 02",
      "Chunk 01",
      "Chunk 00",
    ]);
  });

  it("traces a chunk by its vector id, not its database row id", async () => {
    // Trace identity lists key results as {document_id}:{order}; passing the
    // chunk row's UUID made the journey read as absent everywhere and the
    // chunk text as unavailable.
    api.fetchDocumentChunks.mockResolvedValueOnce(
      makeChunkVisualization({
        chunks: [makeChunk({ id: "row-uuid-1", document_id: "doc-9", chunk_index: 7 })],
      }),
    );

    render(<FileRowDetails node={makeFileNode()} ingestion={ingestion} token="token" />);
    await waitFor(() => expect(screen.getByText(/Chunk 07/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Trace this chunk" }));

    expect(routerPush).toHaveBeenCalledWith(
      `/traces/documents/doc-9?chunk=${encodeURIComponent("doc-9:7")}`,
    );
  });
});
