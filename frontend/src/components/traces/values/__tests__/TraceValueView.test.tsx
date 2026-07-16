import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TraceValueView } from "@/components/traces/values/TraceValueView";

/** Render a value and return the container for shape assertions. */
const view = (value: unknown, kind = "json", focusedItemId?: string) =>
  render(<TraceValueView value={value} kind={kind} focusedItemId={focusedItemId} />).container;

describe("TraceValueView registry", () => {
  it("renders text summaries as prose with a length chip", () => {
    view({ preview: "hello world", length: 11 }, "text");
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.getByText(/11 chars/)).toBeInTheDocument();
  });

  it("renders a source payload as labelled document fields", () => {
    view({ document_id: "doc-1", path: "/tmp/a.pdf", content_type: "application/pdf" });
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByText("doc-1")).toBeInTheDocument();
    expect(screen.getByText("/tmp/a.pdf")).toBeInTheDocument();
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

  it("falls back to normalized JSON for unknown shapes", () => {
    view({ some: "unknown", nested: { shape: [1, 2, 3] } });
    expect(screen.getByText(/"some": "unknown"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expand/i })).toBeInTheDocument();
  });
});
