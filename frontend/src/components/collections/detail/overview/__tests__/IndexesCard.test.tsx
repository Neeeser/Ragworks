import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IndexesCard } from "@/components/collections/detail/overview/IndexesCard";
import * as apiModule from "@/lib/api";
import { makeCollection } from "@/test/fixtures";

import type { CollectionIndexTarget } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

const api = vi.mocked(apiModule);

function denseTarget(overrides: Partial<CollectionIndexTarget> = {}): CollectionIndexTarget {
  return {
    name: "docs-main",
    backend: "pgvector",
    vector_type: "dense",
    dimension: 1536,
    pipelines: ["Default Ingestion Pipeline", "Default Search Tool"],
    ...overrides,
  };
}

function renderCard() {
  render(<IndexesCard collection={makeCollection()} token="token" />);
}

describe("IndexesCard", () => {
  it("states where the data lives, with the pipelines that put it there", async () => {
    api.fetchCollectionIndexes.mockResolvedValue({ targets: [denseTarget()] });
    renderCard();

    expect(await screen.findByText("docs-main")).toBeInTheDocument();
    expect(screen.getByText("1536d")).toBeInTheDocument();
    expect(screen.getByText(/Default Ingestion Pipeline, Default Search Tool/)).toBeInTheDocument();
  });

  it("offers no control at all", async () => {
    api.fetchCollectionIndexes.mockResolvedValue({
      targets: [denseTarget(), denseTarget({ name: "docs-bm25", vector_type: "sparse" })],
    });
    renderCard();

    // The index a pipeline names is the pipeline's decision; any control here
    // would be a second place to make it.
    await screen.findByText("docs-main");
    expect(screen.getByText("BM25")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("says so plainly when the bound pipelines name no index", async () => {
    api.fetchCollectionIndexes.mockResolvedValue({ targets: [] });
    renderCard();

    expect(await screen.findByText("The bound pipelines name no index.")).toBeInTheDocument();
  });

  it("surfaces a failed load instead of showing an empty card", async () => {
    api.fetchCollectionIndexes.mockRejectedValue(new Error("boom"));
    renderCard();

    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
