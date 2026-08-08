import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      onOpenIndexRegistry={() => undefined}
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

    renderHeader({ onCreatePipeline: onCreate, onOpenIndexRegistry: onManage });

    // The breadcrumb path owns the page's identity; no title block repeats it.
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Pipelines");
    expect(screen.getByRole("link", { name: "Ingestion" })).toHaveAttribute(
      "href",
      "/pipelines/ingestion",
    );
    expect(screen.getByRole("link", { name: "Tools" })).toHaveAttribute("href", "/pipelines/tools");

    fireEvent.click(screen.getByRole("button", { name: "Index registry" }));
    expect(onManage).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: NEW_PIPELINE }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("shows the open pipeline's name and revision as live state", () => {
    renderHeader();

    expect(screen.getByText("Docs ingest")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();
  });

  it("offers renaming beside the name, by pointer and by keyboard", async () => {
    const user = userEvent.setup();
    const onRenamePipeline = vi.fn();

    renderHeader({ onRenamePipeline });

    const rename = screen.getByRole("button", { name: "Rename Docs ingest" });
    await user.click(rename);
    expect(onRenamePipeline).toHaveBeenCalledTimes(1);

    rename.focus();
    await user.keyboard("{Enter}");
    expect(onRenamePipeline).toHaveBeenCalledTimes(2);
  });

  it("offers no rename while no pipeline is open", () => {
    renderHeader({ hasPipeline: false, onRenamePipeline: () => undefined });

    expect(screen.queryByRole("button", { name: /^Rename/ })).not.toBeInTheDocument();
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
        onOpenIndexRegistry={() => undefined}
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

  it("offers Run only where a pipeline can answer a query", () => {
    const onOpenRun = vi.fn();

    // An ingestion graph has no query to run a sample through, so the control
    // is absent rather than present and refusing.
    renderHeader();
    expect(screen.queryByRole("button", { name: "Run" })).not.toBeInTheDocument();

    renderHeader({ kind: "retrieval", onOpenRun });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onOpenRun).toHaveBeenCalled();
  });
});
