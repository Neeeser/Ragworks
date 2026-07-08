import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreatePipelineWizard } from "@/components/pipelines/CreatePipelineWizard";
import * as apiModule from "@/lib/api";
import {
  makeBackendInfo,
  makePineconeBackendInfo,
  makeVectorIndex,
  makePipeline,
} from "@/test/fixtures";

import type { VectorIndex } from "@/lib/types";

const pipelineUtils = {
  buildDefaultDefinition: vi.fn(),
};
const createPipelineLabel = "Create pipeline";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/components/pipelines/lib/pipeline-utils", () => ({
  buildDefaultDefinition: (...args: unknown[]) => pipelineUtils.buildDefaultDefinition(...args),
  sortIndexesByName: (indexes: { name: string }[]) =>
    [...indexes].sort((a, b) => a.name.localeCompare(b.name)),
}));

const api = vi.mocked(apiModule);

describe("CreatePipelineWizard", () => {
  const pipeline = makePipeline({ kind: "ingestion", definition: { nodes: [], edges: [] } });

  beforeEach(() => {
    pipelineUtils.buildDefaultDefinition.mockReturnValue({ nodes: [], edges: [] });
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <CreatePipelineWizard
        open={false}
        token="token"
        kind="ingestion"
        indexes={[]}
        backends={[makeBackendInfo(), makePineconeBackendInfo()]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("handles step navigation and index creation prompt", async () => {
    const user = userEvent.setup();
    const onOpenIndexManager = vi.fn();
    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[]}
        backends={[makeBackendInfo(), makePineconeBackendInfo()]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={onOpenIndexManager}
      />,
    );

    expect(screen.getByText("Basics")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Ingestion/), "New");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Select an index/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText(/No pgvector \(PostgreSQL\) indexes/)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "__create__");
    expect(onOpenIndexManager).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Create index/ }));
    expect(onOpenIndexManager).toHaveBeenCalledTimes(2);
  }, 10000);

  it("requires an index selection before proceeding", async () => {
    const user = userEvent.setup();
    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[makeVectorIndex({ name: "alpha", dimension: 768 })]}
        backends={[makeBackendInfo(), makePineconeBackendInfo()]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={() => undefined}
      />,
    );

    await user.type(screen.getByPlaceholderText(/Ingestion/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox"), "alpha");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("creates a pipeline and handles errors", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const indexes: VectorIndex[] = [makeVectorIndex({ name: "alpha", dimension: 768 })];

    api.createPipeline.mockResolvedValueOnce(pipeline);

    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="retrieval"
        indexes={indexes}
        backends={[makeBackendInfo(), makePineconeBackendInfo()]}
        onClose={onClose}
        onCreated={onCreated}
        onOpenIndexManager={() => undefined}
      />,
    );

    await user.type(screen.getByPlaceholderText(/Ingestion/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.selectOptions(screen.getByRole("combobox"), "alpha");
    const stepTwoNext = screen.getByRole("button", { name: "Next" });
    expect(stepTwoNext).toBeEnabled();
    await user.click(stepTwoNext);

    expect(screen.getByText(/Summary/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith(
        "retrieval",
        "pgvector",
        "alpha",
        768,
      );
      expect(onCreated).toHaveBeenCalledWith(pipeline);
      expect(onClose).toHaveBeenCalled();
    });

    api.createPipeline.mockRejectedValueOnce(new Error("Boom"));
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));
    expect(await screen.findByText("Boom")).toBeInTheDocument();

    api.createPipeline.mockRejectedValueOnce("bad");
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));
    expect(await screen.findByText("Unable to create pipeline.")).toBeInTheDocument();
  });

  it("creates pipelines without index dimensions", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    api.createPipeline.mockResolvedValueOnce(pipeline);

    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[makeVectorIndex({ name: "alpha", dimension: null })]}
        backends={[makeBackendInfo(), makePineconeBackendInfo()]}
        onClose={() => undefined}
        onCreated={onCreated}
        onOpenIndexManager={() => undefined}
      />,
    );

    await user.type(screen.getByPlaceholderText(/Ingestion/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.selectOptions(screen.getByRole("combobox"), "alpha");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: createPipelineLabel }));

    await waitFor(() => {
      expect(pipelineUtils.buildDefaultDefinition).toHaveBeenCalledWith(
        "ingestion",
        "pgvector",
        "alpha",
        undefined,
      );
      expect(onCreated).toHaveBeenCalledWith(pipeline);
    });
  });

  it("shows summary defaults when details are missing", async () => {
    const user = userEvent.setup();
    render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={[]}
        backends={[makeBackendInfo(), makePineconeBackendInfo()]}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Review/ }));

    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
  });
});

describe("CreatePipelineWizard backend selection", () => {
  beforeEach(() => {
    pipelineUtils.buildDefaultDefinition.mockReturnValue({ nodes: [], edges: [] });
  });

  function renderStoreStep(overrides?: { pineconeConfigured?: boolean }) {
    const backends = [
      makeBackendInfo(),
      makePineconeBackendInfo({ configured: overrides?.pineconeConfigured ?? true }),
    ];
    const indexes = [
      makeVectorIndex({ name: "local-docs", backend: "pgvector" }),
      makeVectorIndex({ name: "cloud-docs", backend: "pinecone" }),
    ];
    return render(
      <CreatePipelineWizard
        open
        token="token"
        kind="ingestion"
        indexes={indexes}
        backends={backends}
        onClose={() => undefined}
        onCreated={() => undefined}
        onOpenIndexManager={() => undefined}
      />,
    );
  }

  it("preselects pgvector and scopes index options to the chosen backend", async () => {
    const user = userEvent.setup();
    renderStoreStep();
    await user.type(screen.getByPlaceholderText(/Ingestion/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));

    const pgvectorCard = screen.getByRole("button", { name: /pgvector/ });
    expect(pgvectorCard).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("option", { name: /local-docs/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /cloud-docs/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Pinecone/ }));
    expect(screen.getByRole("option", { name: /cloud-docs/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /local-docs/ })).not.toBeInTheDocument();
  });

  it("disables the Pinecone card when no API key is configured", async () => {
    const user = userEvent.setup();
    renderStoreStep({ pineconeConfigured: false });
    await user.type(screen.getByPlaceholderText(/Ingestion/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));

    const pineconeCard = screen.getByRole("button", { name: /Pinecone/ });
    expect(pineconeCard).toBeDisabled();
    expect(screen.getByText(/API key required/)).toBeInTheDocument();
  });

  it("clears the index selection when switching backends", async () => {
    const user = userEvent.setup();
    renderStoreStep();
    await user.type(screen.getByPlaceholderText(/Ingestion/), "Pipe");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.selectOptions(screen.getByRole("combobox"), "local-docs");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Pinecone/ }));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
