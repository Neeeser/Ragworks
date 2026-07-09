import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineNotice } from "@/components/pipelines/PipelineNotice";
import { PipelineRevisions } from "@/components/pipelines/PipelineRevisions";
import { PipelineSavePanel } from "@/components/pipelines/PipelineSavePanel";
import { makePipelineVersion } from "@/test/fixtures";

import type { PendingChange } from "@/components/pipelines/lib/pipeline-diff";
import type { PipelineVersion } from "@/lib/types";

const LAYOUT_UPDATED = "Layout updated";
const SAVE_BUTTON = "Save new revision";

const pendingChanges: PendingChange[] = [
  { kind: "node_config", summary: "Token Chunker: chunk_size 1024 → 512" },
];

describe("pipeline panels", () => {
  it("renders pipeline notices", () => {
    render(<PipelineNotice message="Hello" />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("lists pending changes and saves through the panel", () => {
    const onChangeSummary = vi.fn();
    const onSave = vi.fn();

    render(
      <PipelineSavePanel
        changeSummary=""
        onChangeSummary={onChangeSummary}
        pendingChanges={pendingChanges}
        onSave={onSave}
        saving={false}
        validating={false}
      />,
    );

    expect(screen.getByText("Token Chunker: chunk_size 1024 → 512")).toBeInTheDocument();
    expect(screen.getByText(/1 unsaved change/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Describe this revision/), {
      target: { value: "Update" },
    });
    expect(onChangeSummary).toHaveBeenCalledWith("Update");

    fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    expect(onSave).toHaveBeenCalled();
  });

  it("disables saving when there are no pending changes", () => {
    render(
      <PipelineSavePanel
        changeSummary=""
        onChangeSummary={() => undefined}
        pendingChanges={[]}
        onSave={() => undefined}
        saving={false}
        validating={false}
      />,
    );

    expect(screen.getByRole("button", { name: SAVE_BUTTON })).toBeDisabled();
    expect(screen.getByText(/Everything is saved/)).toBeInTheDocument();
  });

  it("renders revisions with their change lists and activation actions", () => {
    const onActivate = vi.fn();
    const versions: PipelineVersion[] = [
      makePipelineVersion({
        id: "v1",
        version: 1,
        change_summary: "",
        changes: [{ kind: "created", summary: "Initial version" }],
      }),
      makePipelineVersion({
        id: "v2",
        version: 2,
        change_summary: "Update",
        changes: [
          { kind: "node_config", summary: "Chunker: chunk_size 1024 → 512" },
          { kind: "edge_added", summary: "Connected Embedder → Indexer" },
          { kind: "node_renamed", summary: "Renamed 'A' to 'B'" },
          { kind: "layout", summary: LAYOUT_UPDATED },
        ],
      }),
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
    expect(screen.getByText("Initial version")).toBeInTheDocument();
    expect(screen.getByText("Chunker: chunk_size 1024 → 512")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toBeDisabled();

    // The fourth change is collapsed behind "Show 1 more".
    expect(screen.queryByText(LAYOUT_UPDATED)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show 1 more/ }));
    expect(screen.getByText(LAYOUT_UPDATED)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(onActivate).toHaveBeenCalledWith(versions[0]);

    rerender(
      <PipelineRevisions versions={versions} currentVersion={2} saving onActivate={onActivate} />,
    );
    expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled();
  });
});
