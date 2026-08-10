import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { isGeneratedTextList } from "@/components/traces/values/shape-guards";
import { TraceValueView } from "@/components/traces/values/TraceValueView";
import { fetchCollectionAssetBlob } from "@/lib/api";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

/** Render a value and return the container for shape assertions. */
const view = (value: unknown, kind = "json", focusedItemId?: string) =>
  render(<TraceValueView value={value} kind={kind} focusedItemId={focusedItemId} />).container;

describe("TraceValueView registry", () => {
  it("renders a router split as one row per branch, with the branch that took nothing", () => {
    view({
      branches: [
        { branch: "Images", expression: "item.has_image", items: 3 },
        { branch: "Long text", expression: "item.text_length > 200", items: 0 },
      ],
    });
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByText("item.has_image")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // The empty branch is the answer to "why did nothing come out of here",
    // so it stays on screen with its zero rather than being dropped.
    expect(screen.getByText("Long text")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders text summaries as prose with a length chip", () => {
    view({ preview: "hello world", length: 11 }, "text");
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.getByText(/11 chars/)).toBeInTheDocument();
  });

  it("renders a file summary as counts, content types, and stored paths", () => {
    view({
      count: 1,
      media_types: ["application/pdf"],
      paths: ["/tmp/a.pdf"],
      byte_size: 2048,
    });
    expect(screen.getByText("1 files")).toBeInTheDocument();
    expect(screen.getByText("application/pdf")).toBeInTheDocument();
    expect(screen.getByText("/tmp/a.pdf")).toBeInTheDocument();
  });

  it("renders an image summary with its dimensions, not as a file list", () => {
    // A parse node's image output shares `count` + `media_types` with a file
    // summary and carries no paths; claiming it as files drops the dimensions.
    view({
      count: 2,
      media_types: ["image/png"],
      dimensions: ["1224x1584", "unknown"],
    });
    expect(screen.getByText("2 images")).toBeInTheDocument();
    expect(screen.getByText("image/png")).toBeInTheDocument();
    expect(screen.getByText(/1224x1584/)).toBeInTheDocument();
    expect(screen.queryByText("2 files")).not.toBeInTheDocument();
  });

  it("renders retrieval matches with scores and highlights the traced chunk", () => {
    const container = view(
      {
        count: 2,
        top_matches: [
          { rank: 1, chunk_id: "c-1", document_id: "d-1", score: 0.9, preview: "Alpha" },
          { rank: 2, chunk_id: "c-2", document_id: "d-1", score: 0.5, preview: "Beta" },
        ],
      },
      "json",
      "c-2",
    );
    expect(screen.getByText("2 matches")).toBeInTheDocument();
    expect(screen.getByText("0.900")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    // The traced chunk's row gets the highlight frame.
    expect(container.querySelector(".border-accent-cyan\\/70")).toBeInTheDocument();
  });

  it("opens a recorded match without changing trace focus", () => {
    const onOpenItem = vi.fn();
    const onFocusItem = vi.fn();
    render(
      <TraceValueView
        value={{
          count: 1,
          top_matches: [
            { rank: 1, chunk_id: "c-1", document_id: "d-1", score: 0.9, preview: "Alpha" },
          ],
        }}
        kind="json"
        onOpenItem={onOpenItem}
        onFocusItem={onFocusItem}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect result c-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Open chunk c-1" }));
    expect(onOpenItem).toHaveBeenCalledWith("c-1");
    expect(onFocusItem).not.toHaveBeenCalled();
  });

  it("renders an embedding summary with a dimension chip", () => {
    view(
      {
        count: 3,
        dimension: 768,
        samples: [{ chunk_id: "c-1", preview: { preview: [0.1, -0.2, 0.3], total_values: 768 } }],
      },
      "embedding",
    );
    expect(screen.getByText("768-dim")).toBeInTheDocument();
    expect(screen.getByText("3 vectors")).toBeInTheDocument();
  });

  it("renders a chunk batch with a count chip and previews", () => {
    view({
      count: 5,
      document_id: "doc-1",
      samples: [{ chunk_id: "c-1", order: 0, preview: "First chunk text" }],
    });
    expect(screen.getByText("5 chunks")).toBeInTheDocument();
    expect(screen.getByText("First chunk text")).toBeInTheDocument();
  });

  it("keeps a focused full-list item at its original rank", () => {
    const onFocusItem = vi.fn();
    render(
      <TraceValueView
        kind="items"
        value={{
          kind: "matches",
          items: Array.from({ length: 10 }, (_, index) => ({
            id: `c-${index + 1}`,
            score: 1 - index / 10,
          })),
        }}
        focusedItemId="c-9"
        onFocusItem={onFocusItem}
      />,
    );

    const rows = screen.getAllByRole("button", { name: /Trace this result/ });
    expect(rows[0]).toHaveAccessibleName("Trace this result c-1");
    expect(rows[8]).toHaveAccessibleName("Trace this result c-9");
    expect(screen.getByText("#9")).toBeInTheDocument();
    expect(screen.getByText("0.200")).toBeInTheDocument();
    expect(rows[8]).toHaveAttribute("data-focused", "true");

    fireEvent.click(screen.getByRole("button", { name: "Trace this result c-4" }));
    expect(onFocusItem).toHaveBeenCalledWith("c-4");
  });

  it("renders a scalar record as labelled fields", () => {
    view({ enabled: true, model: "cross-encoder" });
    expect(screen.getByText("enabled")).toBeInTheDocument();
    expect(screen.getByText("cross-encoder")).toBeInTheDocument();
  });

  it("renders a bare scalar prominently", () => {
    view(5, "value");
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders generated texts (e.g. query expansion) as a readable list, not raw JSON", () => {
    view([
      { id: "q:llm1", text: "revised query about pricing" },
      { id: "q:llm2", text: "revised query about refunds" },
    ]);
    expect(screen.getByText("revised query about pricing")).toBeInTheDocument();
    expect(screen.getByText("revised query about refunds")).toBeInTheDocument();
    expect(screen.getByText("2 generated")).toBeInTheDocument();
    // The JSON fallback is the tell that the shape fell through unrecognized.
    expect(screen.queryByRole("button", { name: /Expand/i })).not.toBeInTheDocument();
  });

  it("does not let the generated-texts guard claim the match-order shape", () => {
    const matchOrder = [{ rank: 1, chunk_id: "c-1", score: 0.9 }];
    expect(isGeneratedTextList(matchOrder)).toBe(false);

    view(matchOrder);
    // Still renders as reranker order chips (MatchOrderValue), not swallowed.
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("0.900")).toBeInTheDocument();
  });

  it("falls back to normalized JSON for unknown shapes", () => {
    view({ some: "unknown", nested: { shape: [1, 2, 3] } });
    expect(screen.getByText(/"some": "unknown"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand/i })).toBeInTheDocument();
  });
  it("renders an image match's picture beside its placeholder preview", async () => {
    global.URL.createObjectURL = vi.fn(() => "blob:match");
    global.URL.revokeObjectURL = vi.fn();

    await act(async () => {
      view({
        count: 1,
        top_matches: [
          {
            rank: 1,
            chunk_id: "c-img",
            document_id: "d-1",
            score: 0.9,
            preview: "[image: page-12.png]",
            media: {
              media_type: "image/png",
              path: "collections/c1/derived/d1/page-12.png",
              width: 640,
              height: 480,
            },
          },
        ],
      });
    });

    expect(vi.mocked(fetchCollectionAssetBlob)).toHaveBeenCalledWith(
      "test-token",
      "c1",
      "collections/c1/derived/d1/page-12.png",
    );
    expect(screen.getByRole("img", { name: "Image match c-img" })).toBeInTheDocument();
  });

  it("renders a match list recorded before the media field with its preview alone", async () => {
    // Old traces carry no `media` key at all; the placeholder preview is all
    // there is, and nothing must try to fetch bytes for it.
    await act(async () => {
      view({
        count: 1,
        top_matches: [
          {
            rank: 1,
            chunk_id: "c-old",
            document_id: "d-1",
            score: 0.4,
            preview: "[image: legacy.png]",
          },
        ],
      });
    });

    expect(screen.getByText("[image: legacy.png]")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(vi.mocked(fetchCollectionAssetBlob)).not.toHaveBeenCalled();
  });
});
