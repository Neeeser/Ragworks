import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IngestionBadge } from "@/components/files/IngestionBadge";
import { makeFileNode, makeFolderNode } from "@/test/fixtures";

describe("IngestionBadge", () => {
  it("shows a check with the chunk count when ingested", () => {
    render(<IngestionBadge node={makeFileNode()} onRetry={vi.fn()} />);
    expect(screen.getByLabelText("Ingested, 4 chunks")).toBeInTheDocument();
  });

  it("shows a spinner while queued or running", () => {
    const node = makeFileNode({
      ingestion: { ...makeFileNode().ingestion!, status: "processing" },
    });
    render(<IngestionBadge node={node} onRetry={vi.fn()} />);
    expect(screen.getByLabelText("Ingestion in progress")).toBeInTheDocument();
  });

  it("retries a failed file with the error in the accessible name", async () => {
    const onRetry = vi.fn();
    const node = makeFileNode({
      ingestion: {
        ...makeFileNode().ingestion!,
        status: "failed",
        error_message: "parser exploded",
      },
    });
    render(<IngestionBadge node={node} onRetry={onRetry} />);

    const retry = screen.getByRole("button", { name: /parser exploded/i });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith(node);
  });

  it("offers attempt-anyway for never-eligible files", () => {
    render(<IngestionBadge node={makeFileNode({ ingestion: null })} onRetry={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /not supported by your ingestion pipeline/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing for folders", () => {
    const { container } = render(<IngestionBadge node={makeFolderNode()} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
