import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentLegend } from "@/components/collections/detail/visualize/DocumentLegend";
import { buildDocumentSeries } from "@/components/collections/detail/visualize/lib/document-series";
import { makeUmapPoint } from "@/test/fixtures";

import type { UmapPoint } from "@/lib/types";

function pointsFor(documents: Array<[string, string, number]>): UmapPoint[] {
  return documents.flatMap(([documentId, name, chunks]) =>
    Array.from({ length: chunks }, (_unused, index) =>
      makeUmapPoint({
        id: `${documentId}-${index}`,
        document_id: documentId,
        document_name: name,
        chunk_index: index,
      }),
    ),
  );
}

describe("DocumentLegend", () => {
  it("lists every document with a swatch and its chunk count", () => {
    render(
      <DocumentLegend
        series={buildDocumentSeries(
          pointsFor([
            ["doc-a", "Alpha handbook", 3],
            ["doc-b", "Beta notes", 1200],
          ]),
        )}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByText("Alpha handbook").length).toBeGreaterThan(0);
    expect(within(rows[0]).getByText("3")).toBeInTheDocument();
    // A count is data, so it is grouped like every other number in the console.
    expect(within(rows[1]).getByText("1,200")).toBeInTheDocument();
  });

  it("gives two documents different swatch colours", () => {
    const { container } = render(
      <DocumentLegend
        series={buildDocumentSeries(
          pointsFor([
            ["doc-a", "Alpha", 1],
            ["doc-b", "Beta", 1],
          ]),
        )}
      />,
    );

    const swatches = [...container.querySelectorAll("li span[aria-hidden]")].map(
      (node) => (node as HTMLElement).style.background,
    );
    expect(swatches).toHaveLength(2);
    expect(swatches[0]).not.toBe(swatches[1]);
    // Colour comes from the series tokens, never a literal — a hardcoded hue
    // survives no palette but the one it was picked in.
    for (const background of swatches) {
      expect(background).toMatch(/^var\(--series-[1-6]\)$/);
    }
  });

  it("renders nothing when the projection has no points", () => {
    const { container } = render(<DocumentLegend series={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
