import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineNodeLibrary } from "@/components/pipelines/PipelineNodeLibrary";
import { makeNodeSpec } from "@/test/fixtures";

describe("PipelineNodeLibrary", () => {
  it("renders catalog entries and handles preview/drag", () => {
    const onPreviewNode = vi.fn();
    const catalog = [
      {
        family: "chunker" as const,
        specs: [makeNodeSpec({ type: "chunker.token", label: "Token Chunker" })],
      },
    ];

    render(<PipelineNodeLibrary catalog={catalog} onPreviewNode={onPreviewNode} />);

    fireEvent.click(screen.getByRole("button", { name: /Token Chunker/ }));
    expect(onPreviewNode).toHaveBeenCalledWith(catalog[0].specs[0]);

    const dataTransfer = { setData: vi.fn(), effectAllowed: "" } as unknown as DataTransfer;
    fireEvent.dragStart(screen.getByRole("button", { name: /Token Chunker/ }), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/ragworks-node", "chunker.token");
  });

  it("disables every reranker add path without a reranking connection", () => {
    const onPreviewNode = vi.fn();
    const reranker = makeNodeSpec({ type: "reranker.model", label: "Reranker" });
    const catalog = [{ family: "ranking" as const, specs: [reranker] }];

    render(
      <PipelineNodeLibrary
        catalog={catalog}
        onPreviewNode={onPreviewNode}
        hasRerankingProvider={false}
      />,
    );

    const button = screen.getByRole("button", { name: /Reranker/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("draggable", "false");
    fireEvent.click(button);
    expect(onPreviewNode).not.toHaveBeenCalled();
    expect(screen.getByText("Add a reranking provider to continue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("flags a backend-restricted node with the backends it works with", () => {
    const facet = makeNodeSpec({
      type: "facet.bm25",
      label: "BM25 Facet",
      supported_backends: ["pgvector"],
    });
    const catalog = [{ family: "retriever" as const, specs: [facet] }];

    render(
      <PipelineNodeLibrary
        catalog={catalog}
        onPreviewNode={vi.fn()}
        knownBackends={["pgvector", "pinecone"]}
      />,
    );

    // The restriction shows as a backend icon whose tooltip names the store.
    expect(screen.getByRole("tooltip")).toHaveTextContent("Only available on ParadeDB / pgvector");
    // Restriction is informational, not a hard gate — the node is still draggable.
    expect(screen.getByRole("button", { name: /BM25 Facet/ })).not.toBeDisabled();
  });

  it("shows no backend badge for a node that works with every known backend", () => {
    const retriever = makeNodeSpec({
      type: "retriever.vector",
      label: "Retriever",
      supported_backends: ["pgvector", "pinecone"],
    });
    const catalog = [{ family: "retriever" as const, specs: [retriever] }];

    render(
      <PipelineNodeLibrary
        catalog={catalog}
        onPreviewNode={vi.fn()}
        knownBackends={["pgvector", "pinecone"]}
      />,
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
