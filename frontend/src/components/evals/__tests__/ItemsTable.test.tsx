import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ItemsTable } from "@/components/evals/ItemsTable";
import { fetchEvalDatasetAssetBlob } from "@/lib/api";
import { makeEvalRunItem, makeFunnelStage } from "@/test/fixtures";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const STAGES = [
  makeFunnelStage({ node_id: "ingestion", node_type: "ingestion", label: "Ingestion coverage" }),
  makeFunnelStage({
    node_id: "vector-retriever",
    node_type: "retriever.pgvector",
    label: "Semantic Retriever",
  }),
];

describe("ItemsTable", () => {
  it("expands a query into gold-document stage paths and trace links", async () => {
    const user = userEvent.setup();
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA", "docC"],
      retrieved_document_ids: ["docA", "docB"],
      per_node_funnel: [
        { node_id: "ingestion", document_ids: ["docA", "docC"] },
        { node_id: "vector-retriever", document_ids: ["docA", "docB"] },
      ],
    });
    render(
      <ItemsTable
        items={[item]}
        documentTitles={{ docA: "Paris", docC: "Lyon" }}
        stages={STAGES}
        kValues={[1, 5, 10]}
      />,
    );

    // The row-level trace link carries the row's top-ranked chunk: the
    // query-event trace only joins in the ingestion origin — and only shows
    // the per-node scores — for a focused result.
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/traces/queries/qe-1?chunk=uuid-a%3A0",
    );
    expect(screen.getByText("1/2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /expand query q1/i }));

    expect(screen.getByText("retrieved at rank 1")).toBeInTheDocument();
    expect(screen.getByText(/not retrieved — lost at Semantic Retriever/)).toBeInTheDocument();
    const parisLinks = screen.getAllByRole("link", { name: "Paris" });
    expect(parisLinks[0]).toHaveAttribute("href", "/traces/queries/qe-1?chunk=uuid-a%3A0");
    // A gold doc that never surfaced has no chunk to focus, so it renders as
    // plain text rather than a dead link.
    expect(screen.queryByRole("link", { name: "Lyon" })).not.toBeInTheDocument();
    expect(screen.getByText("Lyon")).toBeInTheDocument();
  });

  it("derives its metric columns from what the run actually computed", () => {
    const item = makeEvalRunItem({
      metrics: { "ndcg@10": 0.5, "precision@10": 0.2, "ndcg@5": 0.6 },
    });
    render(
      <ItemsTable
        items={[item]}
        documentTitles={{}}
        stages={STAGES}
        kValues={[5, 10]}
        catalog={[
          {
            name: "precision",
            label: "Precision@k",
            description: "",
            is_rank_aware: false,
          },
          { name: "ndcg", label: "nDCG@k", description: "", is_rank_aware: true },
        ]}
      />,
    );
    // Catalog order, only computed metrics — no hardcoded recall/mrr columns.
    expect(screen.getByText("Precision@10")).toBeInTheDocument();
    expect(screen.getByText("nDCG@10")).toBeInTheDocument();
    expect(screen.queryByText(/Recall/)).not.toBeInTheDocument();
    expect(screen.getByText("0.20")).toBeInTheDocument();
    expect(screen.getByText("0.50")).toBeInTheDocument();
  });

  it("falls back to the pipeline-run trace when no query event was recorded", () => {
    const item = makeEvalRunItem({ query_event_id: null });
    render(<ItemsTable items={[item]} documentTitles={{}} stages={STAGES} kValues={[10]} />);
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/traces/runs/run-1",
    );
  });
});

describe("ItemsTable coverage states", () => {
  it("says a query was not scored rather than showing it as a bad result", () => {
    // Gold that never reached the index: the retriever was never given the
    // chance to return it. Rendering dashes alone would read identically to a
    // query that retrieved nothing, which is how an ingestion failure came to
    // be reported as retrieval quality.
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA"],
      indexed_gold_doc_ids: [],
      metrics: {},
      retrieved_document_ids: [],
    });

    render(<ItemsTable items={[item]} documentTitles={{}} stages={STAGES} kValues={[1, 5, 10]} />);

    expect(screen.getByText(/no gold document reached the index/i)).toBeInTheDocument();
  });

  it("flags a query scored on partial evidence", () => {
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA", "docB", "docC"],
      indexed_gold_doc_ids: ["docA", "docB"],
    });

    render(<ItemsTable items={[item]} documentTitles={{}} stages={STAGES} kValues={[1, 5, 10]} />);

    expect(screen.getByText(/1 of 3 gold documents were not indexed/i)).toBeInTheDocument();
  });

  it("says nothing extra when every gold document was indexed", () => {
    const item = makeEvalRunItem({
      gold_doc_ids: ["docA"],
      indexed_gold_doc_ids: ["docA"],
    });

    render(<ItemsTable items={[item]} documentTitles={{}} stages={STAGES} kValues={[1, 5, 10]} />);

    expect(screen.queryByText(/not indexed|not scored/i)).not.toBeInTheDocument();
  });

  it("marks a query whose pipeline degraded, beside its metrics", () => {
    // The metrics are real and sit in the run's aggregate, so the row has to
    // say they came from a pipeline that only partly ran.
    const item = makeEvalRunItem({ degraded: true });

    render(<ItemsTable items={[item]} documentTitles={{}} stages={STAGES} kValues={[1, 5, 10]} />);

    expect(screen.getByText(/passed its input through/i)).toBeInTheDocument();
  });
  it("renders an image query's picture in place of its empty text", async () => {
    // An image query's item row records no text; the picture it asked with is
    // the only thing that identifies the row.
    global.URL.createObjectURL = vi.fn(() => "blob:query");
    global.URL.revokeObjectURL = vi.fn();
    const item = makeEvalRunItem({
      query_external_id: "img-0001",
      query_text: "",
      query_media: {
        media_type: "image/png",
        path: "eval_datasets/ds-1/queries/q1.png",
        width: 640,
        height: 480,
      },
    });

    await act(async () => {
      render(<ItemsTable items={[item]} documentTitles={{}} stages={STAGES} kValues={[10]} />);
    });

    expect(vi.mocked(fetchEvalDatasetAssetBlob)).toHaveBeenCalledWith(
      "test-token",
      "ds-1",
      "eval_datasets/ds-1/queries/q1.png",
    );
    expect(screen.getByRole("img", { name: "Query image for img-0001" })).toBeInTheDocument();
  });
});
