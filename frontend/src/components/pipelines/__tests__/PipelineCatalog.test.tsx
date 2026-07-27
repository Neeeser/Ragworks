import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PipelineCatalog } from "@/components/pipelines/PipelineCatalog";

import type { Pipeline } from "@/lib/types";

describe("PipelineCatalog", () => {
  const baseTimestamp = "2024-01-01T00:00:00.000Z";
  const pipelines: Pipeline[] = [
    {
      id: "pipe-1",
      user_id: "user-1",
      name: "Pipeline One",
      kind: "ingestion",
      current_version: 2,
      is_default: false,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: { nodes: [], edges: [] },
    },
    {
      id: "pipe-2",
      user_id: "user-1",
      name: "Pipeline Two",
      kind: "retrieval",
      current_version: 1,
      is_default: false,
      created_at: baseTimestamp,
      updated_at: baseTimestamp,
      definition: { nodes: [], edges: [] },
    },
  ];

  it("renders an empty state", () => {
    render(
      <PipelineCatalog
        pipelines={[]}
        selectedPipelineId={undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onCopy={() => undefined}
        pipelineUsage={new Set()}
      />,
    );

    expect(screen.getByText(/No pipelines in this kind yet/)).toBeInTheDocument();
  });

  it("names the default pipeline and shows what each graph does", () => {
    render(
      <PipelineCatalog
        pipelines={[
          {
            ...pipelines[0],
            is_default: true,
            definition: {
              nodes: [
                { id: "n1", type: "parser.document", name: "Parse", config: {} },
                { id: "n2", type: "chunker.token", name: "Chunk", config: {} },
              ],
              edges: [],
            },
          },
          pipelines[1],
        ]}
        selectedPipelineId={undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onCopy={() => undefined}
        pipelineUsage={new Set()}
      />,
    );

    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    // Only the pipeline with a real graph gets a stage strip.
    expect(document.querySelectorAll(".bg-stage-parse")).toHaveLength(1);
    expect(document.querySelectorAll(".bg-stage-chunk")).toHaveLength(1);
  });

  it("handles selection and deletion", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const pipelineUsage = new Set<string>(["pipe-2"]);

    render(
      <PipelineCatalog
        pipelines={pipelines}
        selectedPipelineId={"pipe-1"}
        onSelect={onSelect}
        onDelete={onDelete}
        onCopy={() => undefined}
        pipelineUsage={pipelineUsage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Pipeline One/ }));
    expect(onSelect).toHaveBeenCalledWith(pipelines[0]);

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith(pipelines[0]);

    const inUseDelete = screen.getByRole("button", { name: "Delete Pipeline Two" });
    expect(inUseDelete).toBeDisabled();
    // Every icon-only action explains itself; the in-use one says why it can't run.
    expect(screen.getAllByRole("tooltip").map((node) => node.textContent)).toEqual([
      "Copy pipeline",
      "Delete pipeline",
      "Copy pipeline",
      "Pipelines in use cannot be deleted.",
    ]);
  });

  it("offers a copy action on every pipeline, in use or not", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <PipelineCatalog
        pipelines={pipelines}
        selectedPipelineId={pipelines[0].id}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onCopy={onCopy}
        pipelineUsage={new Set([pipelines[1].id])}
      />,
    );

    // Copying is how one graph becomes two that differ, so a pipeline being
    // in use is exactly when you are most likely to want it.
    await user.click(screen.getByRole("button", { name: "Copy Pipeline Two" }));

    expect(onCopy).toHaveBeenCalledWith(pipelines[1]);
  });
});
