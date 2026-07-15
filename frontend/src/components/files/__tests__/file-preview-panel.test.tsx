import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilePreviewPanel } from "@/components/files/FilePreviewPanel";
import { makeFileNode } from "@/test/fixtures";

vi.mock("@/components/files/FilePreviewContent", () => ({
  FilePreviewContent: () => null,
}));

describe("FilePreviewPanel", () => {
  it("lists ready ingestion warnings in the metadata surface", () => {
    const node = makeFileNode({
      ingestion: {
        ...makeFileNode().ingestion!,
        warnings: [
          "Document doc-1 chunk 0 contained 80 tokens and was split into 3 parts.",
          "Document doc-1 chunk 2 contained 60 tokens and was split into 2 parts.",
        ],
      },
    });

    render(
      <FilePreviewPanel
        token="token"
        node={node}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByText("Ingestion warnings")).toBeInTheDocument();
    expect(screen.getByText(/chunk 0 contained 80 tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/chunk 2 contained 60 tokens/i)).toBeInTheDocument();
  });
});
