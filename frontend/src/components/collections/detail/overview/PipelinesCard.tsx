"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PipelineSelect } from "@/components/collections/detail/overview/PipelineSelect";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";
import {
  addCollectionTool,
  fetchCollection,
  removeCollectionTool,
  updateCollection,
  updateCollectionTool,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Collection, Pipeline } from "@/lib/types";

type PipelinesCardProps = {
  collection: Collection;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  token: string;
  onCollectionUpdated: (collection: Collection) => void;
};

/** The collection's ingest pipeline and primary search tool bindings. */
export function PipelinesCard({
  collection,
  ingestionPipelines,
  retrievalPipelines,
  token,
  onCollectionUpdated,
}: PipelinesCardProps) {
  const [bindings, setBindings] = useState({ ingestion: "", retrieval: "" });
  const [saving, setSaving] = useState(false);
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

  const primaryTool = useMemo(
    () => collection.tools.find((tool) => tool.is_primary) ?? collection.tools[0] ?? null,
    [collection.tools],
  );

  useEffect(() => {
    setBindings({
      ingestion: collection.ingest_pipeline_id ?? defaultIngestion?.id ?? "",
      retrieval: primaryTool?.pipeline_id ?? defaultRetrieval?.id ?? "",
    });
  }, [collection, defaultIngestion, defaultRetrieval, primaryTool]);

  const dirty =
    bindings.ingestion !== (collection.ingest_pipeline_id ?? defaultIngestion?.id ?? "") ||
    bindings.retrieval !== (primaryTool?.pipeline_id ?? defaultRetrieval?.id ?? "");

  const applyPrimaryTool = async (pipelineId: string) => {
    const existing = collection.tools.find((tool) => tool.pipeline_id === pipelineId);
    if (existing) {
      if (!existing.is_primary) {
        await updateCollectionTool(token, collection.id, existing.id, { is_primary: true });
      }
    } else {
      const created = await addCollectionTool(token, collection.id, {
        pipeline_id: pipelineId,
      });
      if (!created.is_primary) {
        await updateCollectionTool(token, collection.id, created.id, { is_primary: true });
      }
    }
    // Switching the search pipeline replaces it (the Tools panel is where
    // multiple tools are curated) — drop the previous primary binding.
    if (primaryTool && primaryTool.pipeline_id !== pipelineId) {
      await removeCollectionTool(token, collection.id, primaryTool.id);
    }
  };

  const handleApply = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (bindings.ingestion !== (collection.ingest_pipeline_id ?? defaultIngestion?.id ?? "")) {
        await updateCollection(token, collection.id, {
          ingest_pipeline_id: bindings.ingestion || null,
        });
      }
      if (
        bindings.retrieval &&
        bindings.retrieval !== (primaryTool?.pipeline_id ?? defaultRetrieval?.id ?? "")
      ) {
        await applyPrimaryTool(bindings.retrieval);
      }
      onCollectionUpdated(await fetchCollection(token, collection.id));
      setMessage("Pipelines updated.");
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to update pipelines."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard className="rounded-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Pipelines</p>
        <Link
          href="/pipelines"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas rounded-lg"
        >
          Edit pipelines
        </Link>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
            Ingestion
          </p>
          <PipelineSelect
            label="Ingestion pipeline"
            pipelines={ingestionPipelines}
            value={bindings.ingestion}
            onChange={(id) => setBindings((prev) => ({ ...prev, ingestion: id }))}
          />
        </div>
        <div>
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
            Search tool
          </p>
          <PipelineSelect
            label="Primary search tool pipeline"
            pipelines={retrievalPipelines}
            value={bindings.retrieval}
            onChange={(id) => setBindings((prev) => ({ ...prev, retrieval: id }))}
          />
        </div>
      </div>
      {(dirty || message) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {dirty && (
            <Button onClick={handleApply} loading={saving}>
              Apply
            </Button>
          )}
          {message && <p className="text-sm text-body">{message}</p>}
        </div>
      )}
    </GlassCard>
  );
}
