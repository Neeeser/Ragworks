import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useExpectedEmbeddingDimension } from "@/components/pipelines/hooks/use-expected-embedding-dimension";
import { IndexSourceField } from "@/components/pipelines/IndexSourceField";
import * as apiModule from "@/lib/api";
import { makeCatalogModel, makeVectorIndex } from "@/test/fixtures";

import type { TypedEdgeType } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { CatalogModel, EmbeddingDimensionResponse } from "@/lib/types";
import type { Node } from "@xyflow/react";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);
const TOKEN = "test-token";
const INDEXER_ID = "indexer-1";
const EMBEDDER_ID = "embedder-1";

const buildNode = (
  id: string,
  nodeType: string,
  config: Record<string, unknown> = {},
): Node<PipelineNodeData> => ({
  id,
  type: "pipelineNode",
  position: { x: 0, y: 0 },
  data: { label: nodeType, nodeType, inputs: [], outputs: [], config },
});

const buildEdge = (source: string, target: string): TypedEdgeType => ({
  id: `${source}->${target}`,
  source,
  target,
  type: "typed",
});

const buildGraph = (connectionId: string, modelId: string) => {
  const embedder = buildNode(EMBEDDER_ID, "embedder.text", {
    connection_id: connectionId,
    model_name: modelId,
  });
  const indexer = buildNode(INDEXER_ID, "indexer.pgvector");
  return {
    embedder,
    indexer,
    nodes: [embedder, indexer],
    edges: [buildEdge(EMBEDDER_ID, INDEXER_ID)],
  };
};

describe("useExpectedEmbeddingDimension", () => {
  it("resolves via the endpoint when the upstream embedder's catalog entry publishes no width", async () => {
    const connectionId = "conn-openrouter";
    const modelId = "baai/bge-base-en-v1.5";
    api.fetchEmbeddingDimension.mockResolvedValueOnce({
      connection_id: connectionId,
      model_id: modelId,
      dimension: 768,
    });
    const { indexer, nodes, edges } = buildGraph(connectionId, modelId);
    // OpenRouter's actual catalog shape: the model is listed, but with no
    // published dimension at all.
    const embeddingModels: CatalogModel[] = [
      makeCatalogModel({ connection_id: connectionId, id: modelId, dimension: null }),
    ];

    const { result } = renderHook(() =>
      useExpectedEmbeddingDimension({
        inspectedNode: indexer,
        nodes,
        edges,
        modelCatalogs: { token: TOKEN, embeddingModels },
      }),
    );

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(768));
    expect(api.fetchEmbeddingDimension).toHaveBeenCalledWith(TOKEN, connectionId, modelId);
  });

  it("does not fall back to the endpoint when the catalog already published a width", () => {
    const connectionId = "conn-openai";
    const modelId = "text-embedding-3-small";
    const { indexer, nodes, edges } = buildGraph(connectionId, modelId);
    const embeddingModels: CatalogModel[] = [
      makeCatalogModel({ connection_id: connectionId, id: modelId, dimension: 1536 }),
    ];

    const { result } = renderHook(() =>
      useExpectedEmbeddingDimension({
        inspectedNode: indexer,
        nodes,
        edges,
        modelCatalogs: { token: TOKEN, embeddingModels },
      }),
    );

    expect(result.current).toBe(1536);
    expect(api.fetchEmbeddingDimension).not.toHaveBeenCalled();
  });

  it("stays null while unresolved rather than throwing when the lookup fails", async () => {
    const connectionId = "conn-failing";
    const modelId = "some/embedding-model";
    api.fetchEmbeddingDimension.mockRejectedValueOnce(new Error("boom"));
    const { indexer, nodes, edges } = buildGraph(connectionId, modelId);
    const embeddingModels: CatalogModel[] = [
      makeCatalogModel({ connection_id: connectionId, id: modelId, dimension: null }),
    ];

    const { result } = renderHook(() =>
      useExpectedEmbeddingDimension({
        inspectedNode: indexer,
        nodes,
        edges,
        modelCatalogs: { token: TOKEN, embeddingModels },
      }),
    );

    expect(result.current).toBeNull();
    await waitFor(() => expect(api.fetchEmbeddingDimension).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });
});

/** A minimal drawer stand-in wiring the hook straight into the index field,
 * proving the endpoint-resolved width actually reaches the picker's marking
 * -- not just that the hook returns a number in isolation. */
function IndexPickerHarness({
  connectionId,
  modelId,
  embeddingModels,
}: {
  connectionId: string;
  modelId: string;
  embeddingModels: CatalogModel[];
}) {
  const { indexer, nodes, edges } = buildGraph(connectionId, modelId);
  const expectedDimension = useExpectedEmbeddingDimension({
    inspectedNode: indexer,
    nodes,
    edges,
    modelCatalogs: { token: TOKEN, embeddingModels },
  });
  const mismatchedIndex = makeVectorIndex({ name: "legacy-index", dimension: 384 });

  return (
    <IndexSourceField
      indexes={[mismatchedIndex]}
      backend="pgvector"
      indexValue="legacy-index"
      variableName={null}
      variables={[]}
      expectedDimension={expectedDimension}
      onPickIndex={() => undefined}
      onBindVariable={() => undefined}
      onDeclareVariable={() => undefined}
    />
  );
}

describe("index picker marking driven by the resolved dimension", () => {
  it("marks nothing before the endpoint resolves, then marks the incompatible index once it does", async () => {
    // The shared endpoint cache is a module-level singleton (deliberately,
    // per app/AGENTS.md's shared-cache rule) -- a distinct pair from every
    // other test in this file so an earlier resolution can't leak in here.
    const connectionId = "conn-openrouter-picker";
    const modelId = "baai/bge-base-en-v1.5-picker";
    // A manually controlled promise, so the "still unresolved" assertion
    // below is deterministic rather than racing a mock that resolves on the
    // next microtask.
    let resolveLookup!: (value: EmbeddingDimensionResponse) => void;
    const pending = new Promise<EmbeddingDimensionResponse>((resolve) => {
      resolveLookup = resolve;
    });
    api.fetchEmbeddingDimension.mockReturnValueOnce(pending);
    const embeddingModels: CatalogModel[] = [
      makeCatalogModel({ connection_id: connectionId, id: modelId, dimension: null }),
    ];

    render(
      <IndexPickerHarness
        connectionId={connectionId}
        modelId={modelId}
        embeddingModels={embeddingModels}
      />,
    );

    // Unresolved: the selected index is not marked incompatible yet.
    expect(screen.queryByText(/This node will fail until they match/)).not.toBeInTheDocument();

    resolveLookup({ connection_id: connectionId, model_id: modelId, dimension: 768 });

    // Once the endpoint resolves a mismatched width, the plain-language
    // banner names both numbers.
    expect(
      await screen.findByText(
        "Produces 768-dimension vectors; this index stores 384. This node will fail until they match.",
      ),
    ).toBeInTheDocument();
  });
});
