"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PipelineSelect } from "@/components/pipelines/PipelineSelect";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { setPrimaryCollectionTool, updateCollection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Collection, Pipeline } from "@/lib/types";

type PipelinesCardProps = {
  collection: Collection;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  token: string;
  onCollectionUpdated: (collection: Collection) => void;
  onToolsChanged: () => void;
};

/** The collection's ingest pipeline and primary search tool bindings. */
export function PipelinesCard({
  collection,
  ingestionPipelines,
  retrievalPipelines,
  token,
  onCollectionUpdated,
  onToolsChanged,
}: PipelinesCardProps) {
  const [bindings, setBindings] = useState({ ingestion: "", retrieval: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleApply = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      // Each endpoint returns the updated collection; folding those in beats
      // re-reading it, which can still see the pre-write state.
      let updated = collection;
      if (bindings.ingestion !== (collection.ingest_pipeline_id ?? defaultIngestion?.id ?? "")) {
        updated = await updateCollection(token, collection.id, {
          ingest_pipeline_id: bindings.ingestion || null,
        });
      }
      if (
        bindings.retrieval &&
        bindings.retrieval !== (primaryTool?.pipeline_id ?? defaultRetrieval?.id ?? "")
      ) {
        updated = await setPrimaryCollectionTool(token, collection.id, bindings.retrieval);
        onToolsChanged();
      }
      onCollectionUpdated(updated);
      setMessage("Pipelines updated.");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update pipelines."));
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
      {(dirty || message || error) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {dirty && (
            <Button size="sm" onClick={handleApply} loading={saving}>
              Apply
            </Button>
          )}
          {error ? (
            <p className="text-ui text-data-neg">{error}</p>
          ) : (
            message && <p className="text-ui text-body">{message}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
