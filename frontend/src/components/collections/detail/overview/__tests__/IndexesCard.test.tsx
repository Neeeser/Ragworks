import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IndexesCard } from "@/components/collections/detail/overview/IndexesCard";
import * as apiModule from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { makeCollection } from "@/test/fixtures";
import { makeVectorIndex } from "@/test/fixtures/indexes";

import type { CollectionIndexSlot } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

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

describe("IndexesCard", () => {
  it("lists each slot with its current index and the pipelines sharing it", async () => {
    api.fetchCollectionIndexes.mockResolvedValue({ slots: [denseSlot()] });
    seedIndexes();
    render(<IndexesCard collection={makeCollection()} token="token" />);

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
    render(<IndexesCard collection={makeCollection()} token="token" />);

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
    render(<IndexesCard collection={makeCollection()} token="token" />);

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
    render(<IndexesCard collection={makeCollection()} token="token" />);

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
    render(<IndexesCard collection={makeCollection()} token="token" />);

    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/768-dimensional/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
