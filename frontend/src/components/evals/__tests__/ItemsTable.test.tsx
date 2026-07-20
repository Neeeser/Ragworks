import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ItemsTable } from "@/components/evals/ItemsTable";
import { makeEvalRunItem, makeFunnelStage } from "@/test/fixtures";

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

    // The row-level trace link targets the query-event trace, which is the
    // source kind that can join in the ingestion origin.
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/traces/queries/qe-1",
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
