import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineHeader } from "@/components/pipelines/PipelineHeader";

import type { ComponentProps } from "react";

const SAVE_VERSION = "Save version";

const renderHeader = (overrides: Partial<ComponentProps<typeof PipelineHeader>> = {}) =>
  render(
    <PipelineHeader
      kind="ingestion"
      onCreatePipeline={() => undefined}
      onManageIndexes={() => undefined}
      unsavedCount={0}
      onOpenSave={() => undefined}
      onOpenHistory={() => undefined}
      hasPipeline
      {...overrides}
    />,
  );

describe("PipelineHeader", () => {
  it("renders ingestion header and actions", () => {
    const onCreate = vi.fn();
    const onManage = vi.fn();

    renderHeader({ onCreatePipeline: onCreate, onManageIndexes: onManage });

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
    renderHeader({ kind: "retrieval" });

    expect(screen.getByText("Design retrieval flows.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "retrieval" })).toHaveAttribute(
      "href",
      "/pipelines/retrieval",
    );
  });

  it("disables saving while clean and shows the unsaved pill once dirty", () => {
    const onOpenSave = vi.fn();
    const onOpenHistory = vi.fn();

    const { rerender } = renderHeader({ onOpenSave, onOpenHistory });

    expect(screen.queryByText(/unsaved/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: SAVE_VERSION })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onOpenHistory).toHaveBeenCalled();

    rerender(
      <PipelineHeader
        kind="ingestion"
        onCreatePipeline={() => undefined}
        onManageIndexes={() => undefined}
        unsavedCount={3}
        onOpenSave={onOpenSave}
        onOpenHistory={onOpenHistory}
        hasPipeline
      />,
    );

    expect(screen.getByText("3 unsaved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: SAVE_VERSION }));
    expect(onOpenSave).toHaveBeenCalled();
  });

  it("hides the save cluster when no pipeline is selected", () => {
    renderHeader({ hasPipeline: false });

    expect(screen.queryByRole("button", { name: SAVE_VERSION })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument();
  });
});
