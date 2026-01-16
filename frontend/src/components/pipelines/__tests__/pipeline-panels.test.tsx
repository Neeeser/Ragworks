import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineNotice } from "@/components/pipelines/PipelineNotice";
import { PipelineRevisions } from "@/components/pipelines/PipelineRevisions";
import { PipelineSavePanel } from "@/components/pipelines/PipelineSavePanel";

import type { PipelineVersion } from "@/lib/types";

describe("pipeline panels", () => {
  it("renders pipeline notices", () => {
    render(<PipelineNotice message="Hello" />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("handles save panel interactions", () => {
    const onChangeSummary = vi.fn();
    const onSave = vi.fn();

    const { rerender } = render(
      <PipelineSavePanel
        changeSummary=""
        onChangeSummary={onChangeSummary}
        onSave={onSave}
        saving={false}
        validating={false}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Change summary"), {
      target: { value: "Update" },
    });
    expect(onChangeSummary).toHaveBeenCalledWith("Update");

    fireEvent.click(screen.getByRole("button", { name: "Save pipeline" }));
    expect(onSave).toHaveBeenCalled();

    rerender(
      <PipelineSavePanel
        changeSummary=""
        onChangeSummary={onChangeSummary}
        onSave={onSave}
        saving
        validating={false}
      />,
    );
    expect(screen.getByRole("button", { name: /Working/ })).toBeDisabled();
  });

  it("renders revisions and activation actions", () => {
    const onActivate = vi.fn();
    const versions: PipelineVersion[] = [
      {
        id: "v1",
        pipeline_id: "p1",
        version: 1,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        change_summary: "",
      },
      {
        id: "v2",
        pipeline_id: "p1",
        version: 2,
        created_at: "2024-01-02T00:00:00.000Z",
        updated_at: "2024-01-02T00:00:00.000Z",
        change_summary: "Update",
      },
    ];

    const { rerender } = render(
      <PipelineRevisions
        versions={[]}
        currentVersion={undefined}
        saving={false}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByText("No revisions loaded.")).toBeInTheDocument();

    rerender(
      <PipelineRevisions
        versions={versions}
        currentVersion={2}
        saving={false}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("No summary provided.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(onActivate).toHaveBeenCalledWith(versions[0]);

    rerender(
      <PipelineRevisions versions={versions} currentVersion={2} saving onActivate={onActivate} />,
    );
    expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled();
  });
});
