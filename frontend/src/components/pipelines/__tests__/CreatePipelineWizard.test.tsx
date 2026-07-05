import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePipelineWizard } from "@/components/pipelines/CreatePipelineWizard";

import type { PineconeIndex, Pipeline } from "@/lib/types";

const api = {
  createPipeline: vi.fn(),
};
const pipelineUtils = {
  buildDefaultDefinition: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  createPipeline: (...args: unknown[]) => api.createPipeline(...args),
}));
vi.mock("@/components/pipelines/pipeline-utils", () => ({
  buildDefaultDefinition: (...args: unknown[]) => pipelineUtils.buildDefaultDefinition(...args),
  sortIndexesByName: (indexes: { name: string }[]) =>
    [...indexes].sort((a, b) => a.name.localeCompare(b.name)),
}));

describe("CreatePipelineWizard", () => {
  const pipeline: Pipeline = {
    id: "pipe-1",
    user_id: "user-1",
    name: "Pipeline",
    kind: "ingestion",
    current_version: 1,
    is_default: false,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    definition: { nodes: [], edges: [] },
  };

  beforeEach(() => {
    api.createPipeline.mockReset();
    pipelineUtils.buildDefaultDefinition.mockReset();
    pipelineUtils.buildDefaultDefinition.mockReturnValue({ nodes: [], edges: [] });
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <CreatePipelineWizard
        open={false}
        token="token"
        kind="ingestion"
        indexes={[]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("handles step navigation and index creation prompt", () => {
    const onOpenIndexManager = vi.fn();
    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={onOpenIndexManager}
      />,
    );

    expect(screen.getByText("Basics")).toBeInTheDocument();
    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Ingestion/), { target: { value: "New" } });
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(screen.getByText(/Select an index/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText(/No Pinecone indexes/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__create__" } });
    expect(onOpenIndexManager).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Create index/ }));
    expect(onOpenIndexManager).toHaveBeenCalled();
  }, 10000);

  it("requires an index selection before proceeding", () => {
    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[
          { name: "alpha", dimension: 768, metric: "cosine", host: null, spec: null, status: null },
        ]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Ingestion/), { target: { value: "Pipe" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alpha" } });
    expect(nextButton).toBeEnabled();
  });

  it("creates a pipeline and handles errors", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const indexes: PineconeIndex[] = [
      { name: "alpha", dimension: 768, metric: "cosine", host: null, spec: null, status: null },
    ];

    api.createPipeline.mockResolvedValueOnce(pipeline);

    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="retrieval"
        indexes={indexes}
        onClose={onClose}
        onCreated={onCreated}
        onOpenIndexManager={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Ingestion/), { target: { value: "Pipe" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alpha" } });
    const stepTwoNext = screen.getByRole("button", { name: "Next" });
    expect(stepTwoNext).toBeEnabled();
    fireEvent.click(stepTwoNext);

    expect(screen.getByText(/Summary/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() => {
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith("retrieval", "alpha", 768);
      expect(onCreated).toHaveBeenCalledWith(pipeline);
      expect(onClose).toHaveBeenCalled();
    });

    api.createPipeline.mockRejectedValueOnce(new Error("Boom"));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    });

    expect(await screen.findByText("Boom")).toBeInTheDocument();

    api.createPipeline.mockRejectedValueOnce("bad");
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    expect(await screen.findByText("Unable to create pipeline.")).toBeInTheDocument();
  });

  it("creates pipelines without index dimensions", async () => {
    const onCreated = vi.fn();
    api.createPipeline.mockResolvedValueOnce(pipeline);

    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[
          {
            name: "alpha",
            dimension: null,
            metric: "cosine",
            host: null,
            spec: null,
            status: null,
          },
        ]}
        onClose={() => undefined}
        onCreated={onCreated}
        onOpenIndexManager={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Ingestion/), { target: { value: "Pipe" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() => {
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith(
        "ingestion",
        "alpha",
        undefined,
      );
      expect(onCreated).toHaveBeenCalledWith(pipeline);
    });
  });

  it("shows summary defaults when details are missing", () => {
    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Review/ }));

    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
  });
});
