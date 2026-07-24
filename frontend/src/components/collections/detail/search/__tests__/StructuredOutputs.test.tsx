import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StructuredOutputs } from "@/components/collections/detail/search/StructuredOutputs";

describe("StructuredOutputs", () => {
  it("renders scalar count fields as labeled numbers", () => {
    render(
      <StructuredOutputs
        outputs={[
          ["matching_documents", 2],
          ["matching_chunks", 3],
        ]}
      />,
    );

    expect(screen.getByText("matching_documents")).toBeInTheDocument();
    // The first value cell is the document count.
    expect(screen.getAllByRole("definition")[0]).toHaveTextContent("2");
  });

  it("renders facet buckets as a per-value table with counts", () => {
    render(
      <StructuredOutputs
        outputs={[
          ["facet_field", "filename"],
          [
            "facets",
            [
              { value: "alpha.md", matching_documents: 1, matching_chunks: 2 },
              { value: "beta.md", matching_documents: 1, matching_chunks: 1 },
            ],
          ],
        ]}
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("alpha.md")).toBeInTheDocument();
    expect(within(table).getByText("beta.md")).toBeInTheDocument();
    // alpha.md's row carries its document and chunk counts.
    const alphaRow = within(table).getByText("alpha.md").closest("tr");
    expect(alphaRow).not.toBeNull();
    expect(within(alphaRow as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("groups chunks missing the facet field under a readable label", () => {
    render(
      <StructuredOutputs
        outputs={[["facets", [{ value: null, matching_documents: 1, matching_chunks: 1 }]]]}
      />,
    );

    expect(screen.getByText("(no value)")).toBeInTheDocument();
  });

  it("shows an empty state when the tool returns no fields", () => {
    render(<StructuredOutputs outputs={[]} />);
    expect(screen.getByText(/no output fields/i)).toBeInTheDocument();
  });
});
