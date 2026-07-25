import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineHeader } from "@/components/pipelines/PipelineHeader";

import type { ComponentProps } from "react";

const SAVE_VERSION = "Save version";
const NEW_PIPELINE = "New pipeline";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pipelines/ingestion",
}));

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
      pipelineName="Docs ingest"
      pipelineVersion={4}
      {...overrides}
    />,
  );

describe("PipelineHeader", () => {
  it("names the kind in the crumb path and its route tabs", () => {
    const onCreate = vi.fn();
    const onManage = vi.fn();

    renderHeader({ onCreatePipeline: onCreate, onManageIndexes: onManage });

    // The breadcrumb path owns the page's identity; no title block repeats it.
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Pipelines");
    expect(screen.getByRole("link", { name: "Ingestion" })).toHaveAttribute(
      "href",
      "/pipelines/ingestion",
    );
    // The route param stays `retrieval` (permanent URL); only the label says Tools.
    expect(screen.getByRole("link", { name: "Tools" })).toHaveAttribute(
      "href",
      "/pipelines/retrieval",
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage indexes" }));
    expect(onManage).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: NEW_PIPELINE }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("shows the open pipeline's name and revision as live state", () => {
    renderHeader();

    expect(screen.getByText("Docs ingest")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();
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
        pipelineName="Docs ingest"
        pipelineVersion={4}
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
    // Creating one stays reachable — it is the only thing left to do.
    expect(screen.getByRole("button", { name: NEW_PIPELINE })).toBeInTheDocument();
  });
});
