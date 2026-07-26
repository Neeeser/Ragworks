import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IndexesCard } from "@/components/collections/detail/overview/IndexesCard";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { makeCollection, makePipeline } from "@/test/fixtures";
import { makeVectorIndex } from "@/test/fixtures/indexes";
import { makeCollectionTool } from "@/test/fixtures/tools";

import type { CollectionIndexSlot, Pipeline, PipelineVariable } from "@/lib/types";
import type { CollectionTool } from "@/lib/types/tools";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

const api = vi.mocked(apiModule);

const PRIMARY_INDEX: PipelineVariable = {
  name: "primary_index",
  type: "index",
  source: "binding",
  description: "Vector index this pipeline uses",
  value: { index_id: "row-1", backend: "pgvector", name: "docs-main" },
};

function denseSlot(overrides: Partial<CollectionIndexSlot> = {}): CollectionIndexSlot {
  return {
    name: "primary_index",
    vector_type: "dense",
    description: "Vector index this pipeline uses",
    expected_dimension: 1536,
    current: {
      index_id: "row-1",
      name: "docs-main",
      backend: "pgvector",
      vector_type: "dense",
      dimension: 1536,
      metric: "cosine",
    },
    pipelines: ["Default Ingestion Pipeline", "Default Retrieval Pipeline"],
    ...overrides,
  };
}

function toolPipeline(): Pipeline {
  const pipeline = makePipeline({ id: "pipe-1" });
  return { ...pipeline, definition: { ...pipeline.definition, variables: [PRIMARY_INDEX] } };
}

function seedIndexes() {
  api.listIndexes.mockResolvedValue([
    makeVectorIndex({
      index_id: "row-1",
      name: "docs-main",
      registered: true,
      dimension: 1536,
    }),
    makeVectorIndex({
      index_id: "row-2",
      name: "docs-alt",
      registered: true,
      dimension: 1536,
    }),
    makeVectorIndex({
      index_id: "row-3",
      name: "wrong-dim",
      registered: true,
      dimension: 768,
    }),
  ]);
}

function renderCard(
  overrides: {
    tools?: CollectionTool[];
    toolPipelines?: Pipeline[];
    onToolsChanged?: () => void;
  } = {},
) {
  const onToolsChanged = overrides.onToolsChanged ?? vi.fn();
  render(
    <IndexesCard
      collection={makeCollection()}
      token="token"
      toolPipelines={overrides.toolPipelines ?? []}
      tools={overrides.tools ?? []}
      onToolsChanged={onToolsChanged}
    />,
  );
  return { onToolsChanged };
}

describe("IndexesCard", () => {
  it("lists each slot with its current index and the pipelines sharing it", async () => {
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    seedIndexes();
    renderCard();

    expect(await screen.findByText(/docs-main — pgvector · 1536d/)).toBeInTheDocument();
    expect(
      screen.getByText(/Default Ingestion Pipeline, Default Retrieval Pipeline/),
    ).toBeInTheDocument();
  });

  it("saves a repoint through the fan-out endpoint and warns about data", async () => {
    const user = userEvent.setup();
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    api.updateCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    seedIndexes();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Change" }));
    expect(screen.getByText(/does not move indexed data/i)).toBeInTheDocument();
    expect(screen.getByText(/every pipeline bound to this collection/i)).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /docs-alt/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateCollectionIndexes).toHaveBeenCalledWith("token", expect.any(String), {
        primary_index: { index_id: "row-2" },
      }),
    );
  });

  it("offers a wrong-width index only as a disabled, explained option", async () => {
    const user = userEvent.setup();
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    seedIndexes();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("combobox"));

    const option = screen.getByRole("option", { name: /wrong-dim.*needs 1536d/ });
    expect(option).toHaveAttribute("data-disabled");
  });

  it("creates a compatible index from the slot and selects it", async () => {
    const user = userEvent.setup();
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    api.createIndex.mockResolvedValue(
      makeVectorIndex({ index_id: "row-new", name: "fresh", registered: true, dimension: 1536 }),
    );
    seedIndexes();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.type(screen.getByLabelText(/New 1536d index on pgvector/), "fresh");
    await user.click(screen.getByRole("button", { name: "Create and use" }));

    await waitFor(() =>
      expect(api.createIndex).toHaveBeenCalledWith("token", {
        backend: "pgvector",
        name: "fresh",
        vector_type: "dense",
        dimension: 1536,
        metric: "cosine",
      }),
    );
  });

  it("keeps the dialog open and shows the server's rejection", async () => {
    const user = userEvent.setup();
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    api.updateCollectionIndexes.mockRejectedValue(
      new ApiError(
        400,
        "Variable 'primary_index': index 'wrong-dim' stores 768-dimensional vectors",
      ),
    );
    seedIndexes();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/768-dimensional/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("states which index each tool binding resolves to", async () => {
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    seedIndexes();
    renderCard({
      toolPipelines: [toolPipeline()],
      tools: [
        makeCollectionTool({
          name: "search_alpha",
          variable_values: {
            primary_index: { index_id: "row-2", backend: "pgvector", name: "docs-alt" },
          },
        }),
      ],
    });

    // A binding that diverges from the collection-wide slot is visible rather
    // than hidden behind the merged view.
    expect(await screen.findByText("search_alpha")).toBeInTheDocument();
    expect(screen.getByText("primary_index → docs-alt")).toBeInTheDocument();
  });

  it("repoints one tool binding without touching the others", async () => {
    const user = userEvent.setup();
    const onToolsChanged = vi.fn();
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    api.updateCollectionTool.mockResolvedValue(makeCollectionTool());
    seedIndexes();
    renderCard({
      toolPipelines: [toolPipeline()],
      tools: [makeCollectionTool({ id: "binding-1", name: "search_alpha" })],
      onToolsChanged,
    });

    await user.click(
      await screen.findByRole("button", { name: "Change indexes for search_alpha" }),
    );
    expect(screen.getByText(/does not move indexed data/i)).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /docs-alt/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateCollectionTool).toHaveBeenCalledWith("token", "col-1", "binding-1", {
        variable_values: {
          primary_index: { index_id: "row-2", backend: "pgvector", name: "docs-alt" },
        },
      }),
    );
    expect(onToolsChanged).toHaveBeenCalled();
  });

  it("omits a tool binding whose pipeline declares no index slot", async () => {
    const base = makePipeline({ id: "pipe-1" });
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    seedIndexes();
    renderCard({
      toolPipelines: [{ ...base, definition: { ...base.definition, variables: [] } }],
      tools: [makeCollectionTool({ name: "search_alpha" })],
    });

    await screen.findByText(/docs-main — pgvector · 1536d/);
    expect(screen.queryByText("search_alpha")).not.toBeInTheDocument();
  });
});
