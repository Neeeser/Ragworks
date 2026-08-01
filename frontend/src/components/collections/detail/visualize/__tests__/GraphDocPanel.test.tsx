import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GraphDocPanel } from "@/components/collections/detail/visualize/GraphDocPanel";
import { makeDocument, makeInsightDocPoint } from "@/test/fixtures";
import { getMockRouter } from "@/test/test-utils";

import type { GraphNeighbor } from "@/components/collections/detail/visualize/GraphDocPanel";

const noop = () => {};

describe("GraphDocPanel", () => {
  const point = makeInsightDocPoint({ document_id: "doc-1", document_name: "Handbook.pdf" });
  const neighbors: GraphNeighbor[] = [
    {
      point: makeInsightDocPoint({ document_id: "doc-2", document_name: "Manual.pdf" }),
      similarity: 0.91,
      collisionCount: 2,
    },
    {
      point: makeInsightDocPoint({ document_id: "doc-3", document_name: "Notes.txt" }),
      similarity: 0.64,
      collisionCount: 0,
    },
  ];

  it("shows the document, its ties, and routes to the ingestion trace", () => {
    render(
      <GraphDocPanel
        point={point}
        document={makeDocument({ id: "doc-1", ingestion_run_id: "run-1" })}
        neighbors={neighbors}
        onSelectNeighbor={noop}
        onClose={noop}
      />,
    );

    expect(screen.getByRole("heading", { name: "Handbook.pdf" })).toBeInTheDocument();
    expect(screen.getByText("Manual.pdf")).toBeInTheDocument();
    expect(screen.getByText("0.910")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view trace/i }));
    expect(getMockRouter().push).toHaveBeenCalledWith("/traces/documents/doc-1");
  });

  it("selects a neighbor when its tie row is clicked", () => {
    const onSelectNeighbor = vi.fn();
    render(
      <GraphDocPanel
        point={point}
        document={null}
        neighbors={neighbors}
        onSelectNeighbor={onSelectNeighbor}
        onClose={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Notes\.txt/ }));
    expect(onSelectNeighbor).toHaveBeenCalledWith(neighbors[1].point);
    // Without the document record there is no trace to route to.
    expect(screen.queryByRole("button", { name: /view trace/i })).not.toBeInTheDocument();
  });
});
