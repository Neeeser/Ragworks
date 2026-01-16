import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineHeader } from "@/components/pipelines/PipelineHeader";

describe("PipelineHeader", () => {
  it("renders ingestion header and actions", () => {
    const onCreate = vi.fn();
    const onManage = vi.fn();

    render(
      <PipelineHeader kind="ingestion" onCreatePipeline={onCreate} onManageIndexes={onManage} />,
    );

    expect(screen.getByText("Build ingestion flows.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ingestion" })).toHaveAttribute(
      "href",
      "/pipelines/ingestion",
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage indexes" }));
    expect(onManage).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /New ingestion pipeline/ }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("renders retrieval header text", () => {
    render(
      <PipelineHeader
        kind="retrieval"
        onCreatePipeline={() => undefined}
        onManageIndexes={() => undefined}
      />,
    );

    expect(screen.getByText("Design retrieval flows.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "retrieval" })).toHaveAttribute(
      "href",
      "/pipelines/retrieval",
    );
  });
});
