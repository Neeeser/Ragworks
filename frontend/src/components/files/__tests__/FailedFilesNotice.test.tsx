import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FailedFilesNotice } from "@/components/files/FailedFilesNotice";
import { makeFileNode } from "@/test/fixtures";

import type { DocumentStatus, FileNode } from "@/lib/types";

function file(name: string, status: DocumentStatus): FileNode {
  const base = makeFileNode();
  return makeFileNode({
    id: name,
    name,
    ingestion: {
      ...base.ingestion!,
      status,
      error_message: status === "failed" ? "provider returned 503" : null,
      num_chunks: status === "ready" ? 2 : 0,
    },
  });
}

describe("FailedFilesNotice", () => {
  it("offers one retry for every file that failed to ingest", async () => {
    const onRetry = vi.fn(async () => true);
    render(
      <FailedFilesNotice
        nodes={[file("a.txt", "failed"), file("b.txt", "failed"), file("ok.txt", "ready")]}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("2 files failed to ingest and are not in the index.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry failed files" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way while nothing has failed", () => {
    // Pending and processing are how an ordinary upload looks on its way in;
    // offering a retry there would fire on every upload.
    const { container } = render(
      <FailedFilesNotice
        nodes={[file("ok.txt", "ready"), file("queued.txt", "pending")]}
        onRetry={vi.fn(async () => true)}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
