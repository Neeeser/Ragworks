import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { countStaleFiles, StaleFilesNotice } from "@/components/files/StaleFilesNotice";
import { makeFileNode, makeFolderNode } from "@/test/fixtures";

function staleNode(id: string) {
  return makeFileNode({
    id,
    ingestion: { ...makeFileNode().ingestion!, stale: true },
  });
}

describe("StaleFilesNotice", () => {
  it("renders nothing when no ready file is stale", () => {
    const { container } = render(
      <StaleFilesNotice
        nodes={[makeFileNode(), makeFolderNode()]}
        onReingest={vi.fn(async () => true)}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("counts only stale ready files", () => {
    const pendingStale = makeFileNode({
      id: "f-3",
      ingestion: { ...makeFileNode().ingestion!, stale: true, status: "pending" },
    });
    expect(
      countStaleFiles([staleNode("f-1"), staleNode("f-2"), makeFileNode(), pendingStale]),
    ).toBe(2);
  });

  it("states the count and triggers re-ingestion", async () => {
    const onReingest = vi.fn(async () => true);
    render(<StaleFilesNotice nodes={[staleNode("f-1")]} onReingest={onReingest} />);

    expect(
      screen.getByText("1 file was ingested with an older version of the ingestion pipeline."),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /re-ingest out-of-date files/i }),
    );
    expect(onReingest).toHaveBeenCalledTimes(1);
  });
});
