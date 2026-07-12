"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { GlassCard } from "@/components/ui/panel";
import { updateCollection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { Collection, Pipeline } from "@/lib/types";

type PipelinesCardProps = {
  collection: Collection;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  token: string;
  onCollectionUpdated: (collection: Collection) => void;
};

/** The one place a collection's ingestion/retrieval pipeline bindings live. */
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

  useEffect(() => {
    setBindings({
      ingestion: collection.ingestion_pipeline_id ?? defaultIngestion?.id ?? "",
      retrieval: collection.retrieval_pipeline_id ?? defaultRetrieval?.id ?? "",
    });
  }, [collection, defaultIngestion, defaultRetrieval]);

  const dirty =
    bindings.ingestion !== (collection.ingestion_pipeline_id ?? defaultIngestion?.id ?? "") ||
    bindings.retrieval !== (collection.retrieval_pipeline_id ?? defaultRetrieval?.id ?? "");

  const handleApply = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateCollection(token, collection.id, {
        ingestion_pipeline_id: bindings.ingestion || null,
        retrieval_pipeline_id: bindings.retrieval || null,
      });
      onCollectionUpdated(updated);
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
        <Field
          label="Ingestion"
          labelClassName="font-mono text-[11px] uppercase tracking-[0.28em] text-muted"
        >
          <Select
            value={bindings.ingestion}
            onChange={(event) =>
              setBindings((prev) => ({ ...prev, ingestion: event.target.value }))
            }
          >
            {ingestionPipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Retrieval"
          labelClassName="font-mono text-[11px] uppercase tracking-[0.28em] text-muted"
        >
          <Select
            value={bindings.retrieval}
            onChange={(event) =>
              setBindings((prev) => ({ ...prev, retrieval: event.target.value }))
            }
          >
            {retrievalPipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
        </Field>
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
