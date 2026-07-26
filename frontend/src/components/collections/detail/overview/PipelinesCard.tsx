"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BindingIndexFields } from "@/components/collections/detail/overview/BindingIndexFields";
import { PipelineSelect } from "@/components/collections/detail/overview/PipelineSelect";
import { useIndexes } from "@/components/indexes/use-indexes";
import { indexVariables } from "@/components/pipelines/lib/variable-env";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
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
  const [indexValues, setIndexValues] = useState<Record<string, unknown>>({});
  const { registeredIndexes } = useIndexes(token);

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

  const selectedPipelines = useMemo(
    () =>
      [
        ingestionPipelines.find((pipeline) => pipeline.id === bindings.ingestion),
        retrievalPipelines.find((pipeline) => pipeline.id === bindings.retrieval),
      ].filter((pipeline): pipeline is Pipeline => Boolean(pipeline)),
    [ingestionPipelines, retrievalPipelines, bindings],
  );

  const applyPrimaryTool = async (pipelineId: string) => {
    // The per-binding endpoint takes only this pipeline's own slots — the
    // picker renders the union across both selected pipelines.
    const pipeline = retrievalPipelines.find((candidate) => candidate.id === pipelineId);
    const declared = new Set(
      indexVariables(pipeline?.definition.variables ?? []).map((slot) => slot.name),
    );
    const scoped = Object.fromEntries(
      Object.entries(indexValues).filter(([name]) => declared.has(name)),
    );
    const existing = collection.tools.find((tool) => tool.pipeline_id === pipelineId);
    if (existing) {
      const patch = {
        ...(existing.is_primary ? {} : { is_primary: true }),
        ...(Object.keys(scoped).length > 0 ? { variable_values: scoped } : {}),
      };
      if (Object.keys(patch).length > 0) {
        await updateCollectionTool(token, collection.id, existing.id, patch);
      }
    } else {
      const created = await addCollectionTool(token, collection.id, {
        pipeline_id: pipelineId,
        variable_values: scoped,
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
          variable_values: indexValues,
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
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ui font-medium text-primary">Pipelines</h2>
        <Link
          href="/pipelines"
          className="rounded-control text-instrument font-medium text-muted transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          Edit pipelines
        </Link>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-instrument font-medium text-muted">Ingestion</p>
          <PipelineSelect
            label="Ingestion pipeline"
            pipelines={ingestionPipelines}
            value={bindings.ingestion}
            onChange={(id) => setBindings((prev) => ({ ...prev, ingestion: id }))}
          />
        </div>
        <div>
          <p className="mb-1.5 text-instrument font-medium text-muted">Search tool</p>
          <PipelineSelect
            label="Primary search tool pipeline"
            pipelines={retrievalPipelines}
            value={bindings.retrieval}
            onChange={(id) => setBindings((prev) => ({ ...prev, retrieval: id }))}
          />
        </div>
      </div>
      {/* Shown while a rebind is pending: a new pipeline may target a
          different index, and the user should choose it here rather than
          discover the auto-filled one afterwards. */}
      {dirty && (
        <div className="mt-3">
          <BindingIndexFields
            pipelines={selectedPipelines}
            values={indexValues}
            indexes={registeredIndexes}
            disabled={saving}
            onChange={setIndexValues}
          />
        </div>
      )}
      {(dirty || message) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {dirty && (
            <Button size="sm" onClick={handleApply} loading={saving}>
              Apply
            </Button>
          )}
          {message && <p className="text-ui text-body">{message}</p>}
        </div>
      )}
    </Panel>
  );
}
