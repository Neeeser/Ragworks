import { fireEvent, render, screen } from "@testing-library/react";
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
        pipelineUsage={new Set()}
      />,
    );

    expect(screen.getByText(/No pipelines yet/)).toBeInTheDocument();
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
    expect(screen.getByRole("tooltip")).toHaveTextContent(/cannot be deleted/);
  });
});
