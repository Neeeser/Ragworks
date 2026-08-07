import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PipelineNodeLibrary } from "@/components/pipelines/PipelineNodeLibrary";
import { makeNodeSpec } from "@/test/fixtures";

const TOKEN_CHUNKER = "Token Chunker";
const TOKEN_CHUNKER_TYPE = "chunker.token";

const twoFamilyCatalog = () => [
  {
    family: "chunker" as const,
    specs: [makeNodeSpec({ type: TOKEN_CHUNKER_TYPE, label: TOKEN_CHUNKER })],
  },
  {
    family: "retriever" as const,
    specs: [makeNodeSpec({ type: "retriever.vector", label: "Retriever" })],
  },
];

describe("PipelineNodeLibrary", () => {
  it("finds a node by the label its instance carries on the canvas", async () => {
    const user = userEvent.setup();
    render(
      <PipelineNodeLibrary
        catalog={twoFamilyCatalog()}
        onPreviewNode={vi.fn()}
        onBrowseAll={vi.fn()}
        instanceLabels={{ "retriever.vector": ["Semantic Retriever"] }}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "Search nodes" }), "Semantic Retriever");

    expect(screen.queryByText(/No nodes match/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Retriever$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Token Chunker/ })).not.toBeInTheDocument();
  });

  it("renders catalog entries and handles preview/drag", () => {
    const onPreviewNode = vi.fn();
    const catalog = [
      {
        family: "chunker" as const,
        specs: [makeNodeSpec({ type: TOKEN_CHUNKER_TYPE, label: TOKEN_CHUNKER })],
      },
    ];

    render(
      <PipelineNodeLibrary catalog={catalog} onPreviewNode={onPreviewNode} onBrowseAll={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Token Chunker/ }));
    expect(onPreviewNode).toHaveBeenCalledWith(catalog[0].specs[0]);

    const dataTransfer = { setData: vi.fn(), effectAllowed: "" } as unknown as DataTransfer;
    fireEvent.dragStart(screen.getByRole("button", { name: /Token Chunker/ }), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/ragworks-node",
      TOKEN_CHUNKER_TYPE,
    );
  });

  it("stamps the preset id alongside the node type when a preset row is dragged", () => {
    const shell = makeNodeSpec({
      type: "llm.transform",
      label: "LLM Transform",
      presets: [
        { id: "summarize", label: "Summarize", description: "Summarizes each item.", config: {} },
      ],
    });
    render(
      <PipelineNodeLibrary
        catalog={[{ family: "llm" as const, specs: [shell] }]}
        onPreviewNode={vi.fn()}
        onBrowseAll={vi.fn()}
      />,
    );

    const dataTransfer = { setData: vi.fn(), effectAllowed: "" } as unknown as DataTransfer;
    fireEvent.dragStart(screen.getByRole("button", { name: /Summarize/ }), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/ragworks-node", "llm.transform");
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/ragworks-node-preset",
      "summarize",
    );
  });

  it("filters to one category from the rail and resets through All", () => {
    render(
      <PipelineNodeLibrary
        catalog={twoFamilyCatalog()}
        onPreviewNode={vi.fn()}
        onBrowseAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chunkers (1)" }));
    expect(screen.getByRole("button", { name: /Token Chunker/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Retriever$/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All categories" }));
    expect(screen.getByRole("button", { name: /^Retriever$/ })).toBeInTheDocument();
  });

  it("searches across every category even while one is filtered", () => {
    render(
      <PipelineNodeLibrary
        catalog={twoFamilyCatalog()}
        onPreviewNode={vi.fn()}
        onBrowseAll={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chunkers (1)" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search nodes" }), {
      target: { value: "retriever" },
    });
    expect(screen.getByRole("button", { name: /^Retriever$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Token Chunker/ })).not.toBeInTheDocument();
  });

  it("opens the catalog overlay from the pinned browse row", () => {
    const onBrowseAll = vi.fn();
    render(
      <PipelineNodeLibrary
        catalog={twoFamilyCatalog()}
        onPreviewNode={vi.fn()}
        onBrowseAll={onBrowseAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Browse all nodes/ }));
    expect(onBrowseAll).toHaveBeenCalled();
  });

  it("disables every reranker add path without a reranking connection", () => {
    const onPreviewNode = vi.fn();
    const reranker = makeNodeSpec({ type: "reranker.model", label: "Reranker" });
    const catalog = [{ family: "ranking" as const, specs: [reranker] }];

    render(
      <PipelineNodeLibrary
        catalog={catalog}
        onPreviewNode={onPreviewNode}
        onBrowseAll={vi.fn()}
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
        onBrowseAll={vi.fn()}
        knownBackends={["pgvector", "pinecone"]}
      />,
    );

    // The restriction shows as a backend icon whose tooltip names the store.
    expect(screen.getByText("Only available on ParadeDB / pgvector")).toBeInTheDocument();
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
        onBrowseAll={vi.fn()}
        knownBackends={["pgvector", "pinecone"]}
      />,
    );

    expect(screen.queryByText(/Only available on/)).not.toBeInTheDocument();
  });
});
