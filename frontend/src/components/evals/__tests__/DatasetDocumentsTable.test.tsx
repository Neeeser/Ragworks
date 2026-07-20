import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DatasetDocumentsTable } from "@/components/evals/DatasetDocumentsTable";
import * as apiModule from "@/lib/api";

import type { EvalCollectionDocumentsPage } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const PAGE: EvalCollectionDocumentsPage = {
  total: 120,
  items: [
    {
      document_id: "doc-uuid-1",
      external_doc_id: "d1",
      title: "Alpha doc",
      status: "ready",
      error_message: null,
      num_chunks: 4,
    },
    {
      document_id: "doc-uuid-2",
      external_doc_id: "d2",
      title: null,
      status: "failed",
      error_message: "parse error",
      num_chunks: 0,
    },
  ],
};

function renderTable(onOffset = vi.fn()) {
  render(
    <DatasetDocumentsTable
      datasetId="ds-1"
      page={PAGE}
      loading={false}
      error={null}
      search=""
      onSearch={vi.fn()}
      offset={0}
      pageSize={50}
      onOffset={onOffset}
    />,
  );
  return onOffset;
}

describe("DatasetDocumentsTable", () => {
  it("lists documents with ingestion outcome and trace links", () => {
    renderTable();
    expect(screen.getByText("Alpha doc")).toBeInTheDocument();
    expect(screen.getByText("parse error")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Open" });
    expect(links[0]).toHaveAttribute("href", "/traces/documents/doc-uuid-1");
  });

  it("pages forward through a large collection", async () => {
    const user = userEvent.setup();
    const onOffset = renderTable();
    expect(screen.getByText("1–50 of 120")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onOffset).toHaveBeenCalledWith(50);
  });

  it("expands a row into the document's stored text", async () => {
    api.fetchEvalDatasetDocument.mockResolvedValue({
      external_doc_id: "d1",
      title: "Alpha doc",
      text: "alpha body text",
    });
    const user = userEvent.setup();
    renderTable();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /expand document d1/i }));
    });
    expect(api.fetchEvalDatasetDocument).toHaveBeenCalledWith("test-token", "ds-1", "d1");
    expect(await screen.findByText("alpha body text")).toBeInTheDocument();
  });
});
