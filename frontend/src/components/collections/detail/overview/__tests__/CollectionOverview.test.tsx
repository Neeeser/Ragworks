import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CollectionOverview } from "@/components/collections/detail/CollectionOverview";
import * as apiModule from "@/lib/api";
import { makeCollection, makeCollectionStats, makePipeline } from "@/test/fixtures";

import type { Collection, CollectionIndexTarget } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

const api = vi.mocked(apiModule);

const DENSE_INDEX = "docs-dense";
const HYBRID_INDEX = "docs-hybrid";
const DENSE = "Dense Search Tool";
const HYBRID = "Hybrid Search Tool";

const denseTool = makePipeline({ id: "pipe-1", name: DENSE, is_default: true });
const hybridTool = makePipeline({ id: "pipe-2", name: HYBRID, is_default: false });

function boundTo(pipelineId: string): Collection {
  return makeCollection({
    tools: [
      { id: "binding-1", pipeline_id: pipelineId, is_primary: true, enabled: true, position: 0 },
    ],
  });
}

function target(name: string, pipeline: string): CollectionIndexTarget {
  return {
    name,
    backend: "pgvector",
    vector_type: "dense",
    dimension: 1536,
    pipelines: [pipeline],
  };
}

/** Mirrors the page: it owns the collection and applies what a mutation returns. */
function Harness() {
  const [collection, setCollection] = useState(() => boundTo("pipe-1"));
  return (
    <CollectionOverview
      collection={collection}
      stats={makeCollectionStats()}
      ingestionPipelines={[]}
      retrievalPipelines={[denseTool, hybridTool]}
      token="token"
      onCollectionUpdated={setCollection}
    />
  );
}

describe("CollectionOverview", () => {
  it("refreshes the indexes card when the collection's search tool changes", async () => {
    const user = userEvent.setup();
    api.fetchCollectionIndexes
      .mockResolvedValueOnce({ targets: [target(DENSE_INDEX, DENSE)] })
      .mockResolvedValue({ targets: [target(HYBRID_INDEX, HYBRID)] });
    api.setPrimaryCollectionTool.mockResolvedValue(boundTo("pipe-2"));

    render(<Harness />);
    expect(await screen.findByText(DENSE_INDEX)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Primary search tool pipeline" }));
    await user.click(screen.getByRole("option", { name: new RegExp(HYBRID) }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    // The bound pipelines decide where the data lives, so switching the tool
    // has to update the card without the user reloading the page.
    expect(await screen.findByText(HYBRID_INDEX)).toBeInTheDocument();
    expect(screen.queryByText(DENSE_INDEX)).not.toBeInTheDocument();
  });
});
