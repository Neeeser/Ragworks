import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NodeCatalogOverlay } from "@/components/pipelines/NodeCatalogOverlay";
import { makeNodeSpec } from "@/test/fixtures";

const catalog = () => [
  {
    family: "chunker" as const,
    specs: [
      makeNodeSpec({
        type: "chunker.custom",
        label: "Token Chunker",
        description: "Splits text into token chunks. Keeps metadata.",
      }),
    ],
  },
  {
    family: "llm" as const,
    specs: [
      makeNodeSpec({
        type: "llm.transform",
        label: "LLM Transform",
        description: "Runs a prompt over each item.",
        presets: [
          {
            id: "summarize",
            label: "Summarize",
            description: "Summarizes each item.",
            config: { prompt: "Summarize" },
          },
        ],
      }),
    ],
  },
];

describe("NodeCatalogOverlay", () => {
  it("lists every category with counts and focuses a node into the detail pane", () => {
    render(<NodeCatalogOverlay catalog={catalog()} onClose={vi.fn()} onAddNode={vi.fn()} />);

    expect(screen.getByRole("button", { name: /All nodes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Chunkers/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Token Chunker/ }));
    // The detail pane carries the full description and the mono type id.
    expect(screen.getByText("chunker.custom")).toBeInTheDocument();
    expect(screen.getByText(/Splits text into token chunks\. Keeps metadata\./)).toBeInTheDocument();
  });

  it("adds the focused node to the canvas", () => {
    const onAddNode = vi.fn();
    render(<NodeCatalogOverlay catalog={catalog()} onClose={vi.fn()} onAddNode={onAddNode} />);

    fireEvent.click(screen.getByRole("button", { name: /Token Chunker/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    expect(onAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chunker.custom", label: "Token Chunker" }),
    );
  });

  it("adds a preset as the presetized spec from the detail pane", () => {
    const onAddNode = vi.fn();
    render(<NodeCatalogOverlay catalog={catalog()} onClose={vi.fn()} onAddNode={onAddNode} />);

    fireEvent.click(screen.getByRole("button", { name: /LLM Transform/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAddNode).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "llm.transform",
        label: "Summarize",
        default_config: expect.objectContaining({ prompt: "Summarize" }),
      }),
    );
  });

  it("surfaces presets as searchable peer rows", () => {
    render(<NodeCatalogOverlay catalog={catalog()} onClose={vi.fn()} onAddNode={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search nodes and presets" }), {
      target: { value: "summarize" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Summarize/ }));
    // Focusing the preset row shows the presetized entry in the detail pane.
    expect(screen.getByText("llm.transform")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to canvas" })).toBeInTheDocument();
  });

  it("disables adding a reranker without a reranking provider", () => {
    const reranker = [
      {
        family: "ranking" as const,
        specs: [makeNodeSpec({ type: "reranker.model", label: "Reranker" })],
      },
    ];
    render(
      <NodeCatalogOverlay
        catalog={reranker}
        onClose={vi.fn()}
        onAddNode={vi.fn()}
        hasRerankingProvider={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reranker/ }));
    expect(screen.getByRole("button", { name: "Add to canvas" })).toBeDisabled();
    expect(screen.getByText("Add a reranking provider to continue")).toBeInTheDocument();
  });
});
