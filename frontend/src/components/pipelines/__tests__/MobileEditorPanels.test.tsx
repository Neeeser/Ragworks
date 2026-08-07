import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileEditorPanels } from "@/components/pipelines/MobileEditorPanels";
import { makeNodeSpec } from "@/test/fixtures";

import type { PipelineSidebarProps } from "@/components/pipelines/PipelineSidebar";
import type { Pipeline } from "@/lib/types";

const pipeline: Pipeline = {
  id: "pipe-1",
  user_id: "user-1",
  name: "My Pipeline",
  kind: "retrieval",
  current_version: 1,
  is_default: false,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  definition: { nodes: [], edges: [] },
};

const makeProps = (overrides?: Partial<PipelineSidebarProps>): PipelineSidebarProps => ({
  pipelines: [pipeline],
  selectedPipelineId: pipeline.id,
  catalog: [
    {
      family: "chunker",
      specs: [makeNodeSpec({ type: "chunker.token", label: "Token Chunker" })],
    },
  ],
  onSelectPipeline: vi.fn(),
  onDeletePipeline: vi.fn(),
  onCopyPipeline: vi.fn(),
  pipelineUsage: new Set<string>(),
  onPreviewNode: vi.fn(),
  onBrowseAllNodes: vi.fn(),
  nodeInstanceLabels: {},
  variables: [],
  onVariablesChange: vi.fn(),
  variableNodes: [],
  modelOptions: [],
  indexOptions: [],
  variablesDisabled: false,
  hasRerankingProvider: true,
  rerankingProviderMessage: null,
  knownBackends: [],
  ...overrides,
});

describe("MobileEditorPanels", () => {
  it("opens each panel as a sheet from its pill", () => {
    render(<MobileEditorPanels {...makeProps()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nodes" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Token Chunker/ })).toBeInTheDocument();
  });

  it("closes the sheet when a node is chosen for preview", () => {
    const props = makeProps();
    render(<MobileEditorPanels {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Nodes" }));
    fireEvent.click(screen.getByRole("button", { name: /Token Chunker/ }));
    expect(props.onPreviewNode).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the sheet when a pipeline is selected", () => {
    const props = makeProps();
    render(<MobileEditorPanels {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Pipelines" }));
    fireEvent.click(screen.getAllByRole("button", { name: /My Pipeline/ })[0]);
    expect(props.onSelectPipeline).toHaveBeenCalledWith(pipeline);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hands Browse all off to the catalog overlay and closes", () => {
    const props = makeProps();
    render(<MobileEditorPanels {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Nodes" }));
    fireEvent.click(screen.getByRole("button", { name: /Browse all nodes/ }));
    expect(props.onBrowseAllNodes).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
