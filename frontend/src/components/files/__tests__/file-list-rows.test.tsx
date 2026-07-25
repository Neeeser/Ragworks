import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilesBrowser } from "@/components/files/FilesBrowser";
import * as apiModule from "@/lib/api";
import { makeFileNode, makeFileTree, makeFolderNode } from "@/test/fixtures";

import type { FileIngestion } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);
const readyIngestion = makeFileNode().ingestion as FileIngestion;

const READY_NAME = "handbook.md";
const NOT_INGESTED_NAME = "archive.bin";
const MARKDOWN = "text/markdown";

const folder = makeFolderNode({ id: "n-folder", name: "reports", path: "/reports" });
const ready = makeFileNode({
  id: "n-ready",
  name: READY_NAME,
  path: "/handbook.md",
  content_type: MARKDOWN,
  size_bytes: 2569,
  ingestion: { ...readyIngestion, num_chunks: 2, num_tokens: 730 },
});
const failed = makeFileNode({
  id: "n-failed",
  name: "broken.pdf",
  path: "/broken.pdf",
  content_type: "application/pdf",
  ingestion: { ...readyIngestion, status: "failed", error_message: "pdf parser found no text" },
});
const notIngested = makeFileNode({
  id: "n-none",
  name: NOT_INGESTED_NAME,
  path: "/archive.bin",
  content_type: "application/octet-stream",
  ingestion: null,
});
const processing = makeFileNode({
  id: "n-processing",
  name: "ingesting.md",
  path: "/ingesting.md",
  content_type: MARKDOWN,
  ingestion: { ...readyIngestion, status: "processing" },
});

/** The row for a node, once the tree has landed. */
async function rowFor(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest("li");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`no row for ${name}`);
  }
  return row;
}

/**
 * Cells inside a row that render `text`, excluding the hover tooltips.
 *
 * `Tooltip` renders its content as real text inside the trigger, so a value that
 * also carries a tooltip matches twice; asserting on the visible cell is what
 * makes these tests about the columns rather than about the tooltips.
 */
function cellsWith(row: HTMLElement, text: string): HTMLElement[] {
  return within(row)
    .queryAllByText(text)
    .filter((element) => element.closest('[role="tooltip"]') === null);
}

function renderBrowser() {
  return render(
    <FilesBrowser token="token-1" collectionId="col-1" collectionName="Docs" pathSegments={[]} />,
  );
}

beforeEach(() => {
  api.fetchFileTree.mockResolvedValue(
    makeFileTree({ nodes: [folder, ready, failed, notIngested] }),
  );
});

describe("the file list's row information", () => {
  it("carries every fact about a ready file on one line", async () => {
    renderBrowser();
    const row = await rowFor(READY_NAME);

    // The chunk and token counts used to be reachable only by expanding the row.
    for (const value of ["Ready", MARKDOWN, "2.5 KB", "2", "730"]) {
      expect(cellsWith(row, value)).toHaveLength(1);
    }
  });

  it("shows a failure's own message without opening anything", async () => {
    renderBrowser();
    const row = await rowFor("broken.pdf");

    expect(cellsWith(row, "Failed")).toHaveLength(1);
    // The subtitle, not just the status tooltip.
    expect(cellsWith(row, "pdf parser found no text")).toHaveLength(1);
  });

  it("distinguishes a file with no document record from a failure", async () => {
    renderBrowser();
    const row = await rowFor(NOT_INGESTED_NAME);

    // Not "Failed": the upload persisted, it was simply never pipeline-eligible.
    expect(cellsWith(row, "Not indexed")).toHaveLength(1);
    expect(cellsWith(row, "Failed")).toHaveLength(0);
  });

  it("leaves indexed counts empty rather than printing zero when nothing was indexed", async () => {
    renderBrowser();
    const cells = cellsWith(await rowFor(NOT_INGESTED_NAME), "—");

    // Chunks and tokens; a 0 would claim the file was indexed as nothing.
    expect(cells.length).toBeGreaterThanOrEqual(2);
  });

  it("offers an ingest action only where running ingestion again is meaningful", async () => {
    renderBrowser();
    await screen.findByText(READY_NAME);

    expect(screen.getByRole("button", { name: "Ingest broken.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Ingest ${NOT_INGESTED_NAME}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Ingest ${READY_NAME}` })).not.toBeInTheDocument();
  });

  it("queues ingestion for the file whose action was pressed", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.click(await screen.findByRole("button", { name: `Ingest ${NOT_INGESTED_NAME}` }));

    expect(api.ingestFile).toHaveBeenCalledWith("token-1", "n-none");
  });

  it("pulses only the row whose ingestion is actually running", async () => {
    api.fetchFileTree.mockResolvedValue(makeFileTree({ nodes: [ready, failed, processing] }));
    renderBrowser();
    await screen.findByText(READY_NAME);

    // The pulse depicts data moving; a settled row carrying one would be a lie.
    expect(screen.getAllByRole("status", { name: /^Ingesting / })).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Ingesting ingesting.md" })).toBeInTheDocument();
  });

  it("gives a folder no ingestion state and no chunk detail to open", async () => {
    renderBrowser();
    const row = await rowFor("reports");

    expect(cellsWith(row, "Folder")).toHaveLength(1);
    expect(cellsWith(row, "Ready")).toHaveLength(0);
    expect(within(row).queryByRole("button", { name: /chunks in/ })).not.toBeInTheDocument();
  });

  it("expands a file's chunking configuration in place", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.click(await screen.findByRole("button", { name: `Show chunks in ${READY_NAME}` }));

    const row = await rowFor(READY_NAME);
    for (const value of ["Strategy", "token", "Overlap", "64", "Embedder", "embed-1"]) {
      expect(cellsWith(row, value)).toHaveLength(1);
    }
  });
});
