import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineSidebar } from "@/components/pipelines/PipelineSidebar";

import type { NodeSpec, Pipeline } from "@/lib/types";

const pipelineCatalogMock = vi.fn();
const pipelineLibraryMock = vi.fn();

vi.mock("@/components/pipelines/PipelineCatalog", () => ({
  PipelineCatalog: (props: { selectedPipelineId?: string }) => {
    pipelineCatalogMock(props);
    return <div data-testid="catalog" />;
  },
}));

vi.mock("@/components/pipelines/PipelineNodeLibrary", () => ({
  PipelineNodeLibrary: (props: { catalog: Array<unknown> }) => {
    pipelineLibraryMock(props);
    return <div data-testid="library" />;
  },
}));

describe("PipelineSidebar", () => {
  it("renders catalog and library", () => {
    const pipelines: Pipeline[] = [
      {
        id: "pipe-1",
        user_id: "user-1",
        name: "Pipeline",
        kind: "ingestion",
        current_version: 1,
        is_default: false,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        definition: { nodes: [], edges: [] },
      },
    ];
    const catalog: Array<{ family: "chunker"; specs: NodeSpec[] }> = [
      {
        family: "chunker",
        specs: [],
      },
    ];

    render(
      <PipelineSidebar
        pipelines={pipelines}
        selectedPipelineId="pipe-1"
        catalog={catalog}
        onSelectPipeline={() => undefined}
        onDeletePipeline={() => undefined}
        pipelineUsage={new Set()}
        onPreviewNode={() => undefined}
        variables={[]}
        onVariablesChange={() => undefined}
        variableNodes={[]}
        modelOptions={[]}
        variablesDisabled={false}
      />,
    );

    expect(screen.getByTestId("catalog")).toBeInTheDocument();
    expect(screen.getByTestId("library")).toBeInTheDocument();
    expect(pipelineCatalogMock).toHaveBeenCalled();
    expect(pipelineLibraryMock).toHaveBeenCalled();
  });
});
