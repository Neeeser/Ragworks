"use client";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionOverview } from "@/components/collections/detail/CollectionOverview";
import * as apiModule from "@/lib/api";
import { makeCollection, makeCollectionStats, makePipeline } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const applyPipelinesLabel = "Apply pipelines";

describe("CollectionOverview", () => {
  const collection = makeCollection({ description: " ", retrieval_pipeline_id: null });
  const stats = makeCollectionStats({
    document_count: 0,
    chunk_count: 0,
    average_latency_ms: Number.NaN,
    last_used_at: null,
  });
  const ingestion = makePipeline({
    id: "pipe-1",
    name: "Ingestion",
    kind: "ingestion",
    is_default: true,
  });
  const retrieval = makePipeline({
    id: "pipe-2",
    name: "Retrieval",
    kind: "retrieval",
    is_default: true,
  });

  it("renders summary data and defaults", () => {
    render(
      <CollectionOverview
        collection={collection}
        stats={stats}
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        token="token"
        onCollectionUpdated={() => {}}
      />,
    );

    expect(screen.getByText("No description yet.")).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
  });

  it("updates pipeline bindings successfully", async () => {
    api.updateCollection.mockResolvedValueOnce(makeCollection({ name: "Updated" }));
    const onCollectionUpdated = vi.fn();
    render(
      <CollectionOverview
        collection={collection}
        stats={stats}
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        token="token"
        onCollectionUpdated={onCollectionUpdated}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText(applyPipelinesLabel));
    });

    await waitFor(() => {
      expect(onCollectionUpdated).toHaveBeenCalled();
      expect(screen.getByText("Pipeline bindings updated.")).toBeInTheDocument();
    });
  });

  it("handles update errors", async () => {
    api.updateCollection.mockRejectedValueOnce(new Error("Update failed"));
    render(
      <CollectionOverview
        collection={collection}
        stats={stats}
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        token="token"
        onCollectionUpdated={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText(applyPipelinesLabel));
    });

    await waitFor(() => {
      expect(screen.getByText("Update failed")).toBeInTheDocument();
    });
  });

  it("handles non-error update failures", async () => {
    api.updateCollection.mockRejectedValueOnce("bad");
    render(
      <CollectionOverview
        collection={collection}
        stats={stats}
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        token="token"
        onCollectionUpdated={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText(applyPipelinesLabel));
    });

    await waitFor(() => {
      expect(screen.getByText("Unable to update pipelines.")).toBeInTheDocument();
    });
  });

  it("renders fallback pipeline labels and updates selections", () => {
    const nextCollection = makeCollection({
      description: " ",
      ingestion_pipeline_id: "missing",
      retrieval_pipeline_id: "pipe-2",
      updated_at: "2024-01-02T00:00:00.000Z",
    });
    const nextStats = makeCollectionStats({
      document_count: 0,
      chunk_count: 0,
      average_latency_ms: 12.4,
      last_used_at: "2024-01-01T00:00:00.000Z",
    });

    render(
      <CollectionOverview
        collection={nextCollection}
        stats={nextStats}
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        token="token"
        onCollectionUpdated={() => {}}
      />,
    );

    expect(screen.getAllByText("Ingestion").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Retrieval").length).toBeGreaterThan(0);
    expect(screen.getByText("12 ms")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "pipe-1" } });
    fireEvent.change(selects[1], { target: { value: "pipe-2" } });
  });

  it("shows default pipeline labels when no pipelines exist", () => {
    render(
      <CollectionOverview
        collection={makeCollection({ ingestion_pipeline_id: null, retrieval_pipeline_id: null })}
        stats={stats}
        ingestionPipelines={[]}
        retrievalPipelines={[]}
        token="token"
        onCollectionUpdated={() => {}}
      />,
    );

    expect(screen.getByText("Default ingestion pipeline")).toBeInTheDocument();
    expect(screen.getByText("Default retrieval pipeline")).toBeInTheDocument();
  });

  it("updates pipelines with empty bindings", async () => {
    api.updateCollection.mockResolvedValueOnce(collection);

    render(
      <CollectionOverview
        collection={makeCollection({ ingestion_pipeline_id: null, retrieval_pipeline_id: null })}
        stats={stats}
        ingestionPipelines={[]}
        retrievalPipelines={[]}
        token="token"
        onCollectionUpdated={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText(applyPipelinesLabel));
    });

    await waitFor(() => {
      expect(api.updateCollection).toHaveBeenCalledWith("token", "col-1", {
        ingestion_pipeline_id: null,
        retrieval_pipeline_id: null,
      });
    });
  });

  it("renders fallback stats when data is missing", () => {
    render(
      <CollectionOverview
        collection={collection}
        stats={null}
        ingestionPipelines={[ingestion]}
        retrievalPipelines={[retrieval]}
        token="token"
        onCollectionUpdated={() => {}}
      />,
    );

    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });
});
