"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildCollectionStatItems,
  CollectionStatCard,
} from "@/components/collections/CollectionStats";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";
import { updateCollection } from "@/lib/api";

import type { Collection, CollectionStats, Pipeline } from "@/lib/types";

type CollectionOverviewProps = {
  collection: Collection;
  stats: CollectionStats | null;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  token: string;
  onCollectionUpdated: (collection: Collection) => void;
};

export function CollectionOverview({
  collection,
  stats,
  ingestionPipelines,
  retrievalPipelines,
  token,
  onCollectionUpdated,
}: CollectionOverviewProps) {
  const [pipelineBindings, setPipelineBindings] = useState({
    ingestion: "",
    retrieval: "",
  });
  const [binding, setBinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const defaultIngestion = useMemo(
    () =>
      ingestionPipelines.find((pipeline) => pipeline.is_default) ?? ingestionPipelines[0] ?? null,
    [ingestionPipelines],
  );
  const defaultRetrieval = useMemo(
    () =>
      retrievalPipelines.find((pipeline) => pipeline.is_default) ?? retrievalPipelines[0] ?? null,
    [retrievalPipelines],
  );

  const pipelineNameById = useMemo(() => {
    const entries = [...ingestionPipelines, ...retrievalPipelines].map(
      (pipeline): [string, string] => [pipeline.id, pipeline.name],
    );
    return new Map(entries);
  }, [ingestionPipelines, retrievalPipelines]);

  useEffect(() => {
    setPipelineBindings({
      ingestion: collection.ingestion_pipeline_id ?? defaultIngestion?.id ?? "",
      retrieval: collection.retrieval_pipeline_id ?? defaultRetrieval?.id ?? "",
    });
  }, [collection, defaultIngestion, defaultRetrieval]);

  const handleUpdatePipelines = async () => {
    setBinding(true);
    setMessage(null);
    try {
      const updated = await updateCollection(token, collection.id, {
        ingestion_pipeline_id: pipelineBindings.ingestion || null,
        retrieval_pipeline_id: pipelineBindings.retrieval || null,
      });
      onCollectionUpdated(updated);
      setMessage("Pipeline bindings updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update pipelines.");
    } finally {
      setBinding(false);
    }
  };

  const summaryItems = buildCollectionStatItems(collection, stats);

  return (
    <div className="space-y-6">
      <GlassCard className="rounded-3xl p-6">
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Overview</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">{collection.name}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {collection.description?.trim() || "No description yet."}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Collection id</p>
            <p className="mt-2 break-all text-sm text-white">{collection.id}</p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Ingestion pipeline</p>
            <p className="mt-2 text-sm text-white">
              {pipelineNameById.get(collection.ingestion_pipeline_id ?? "") ??
                defaultIngestion?.name ??
                "Default ingestion pipeline"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Retrieval pipeline</p>
            <p className="mt-2 text-sm text-white">
              {pipelineNameById.get(collection.retrieval_pipeline_id ?? "") ??
                defaultRetrieval?.name ??
                "Default retrieval pipeline"}
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {summaryItems.map((item) => (
          <GlassCard key={item.label} className="rounded-3xl p-4">
            <CollectionStatCard item={item} />
          </GlassCard>
        ))}
      </div>

      <GlassCard className="rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Pipelines</p>
            <h2 className="text-2xl font-semibold">Collection bindings</h2>
            <p className="text-sm text-slate-400">
              Swap ingestion or retrieval flows without reconfiguring the collection.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Ingestion pipeline
            </label>
            <select
              className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
              value={pipelineBindings.ingestion}
              onChange={(event) =>
                setPipelineBindings((prev) => ({
                  ...prev,
                  ingestion: event.target.value,
                }))
              }
            >
              {ingestionPipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Retrieval pipeline
            </label>
            <select
              className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
              value={pipelineBindings.retrieval}
              onChange={(event) =>
                setPipelineBindings((prev) => ({
                  ...prev,
                  retrieval: event.target.value,
                }))
              }
            >
              {retrievalPipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={handleUpdatePipelines} loading={binding}>
            Apply pipelines
          </Button>
          {message && <p className="text-sm text-slate-300">{message}</p>}
        </div>
      </GlassCard>
    </div>
  );
}
