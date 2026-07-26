"use client";

import { useMemo, useState } from "react";

import { BindingIndexDialog } from "@/components/collections/detail/overview/BindingIndexDialog";
import {
  asIndexValue,
  indexOptionLabel,
} from "@/components/collections/detail/overview/BindingIndexFields";
import { CollectionIndexesDialog } from "@/components/collections/detail/overview/CollectionIndexesDialog";
import { useIndexes } from "@/components/indexes/use-indexes";
import { indexVariables } from "@/components/pipelines/lib/variable-env";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { fetchCollectionIndexes, updateCollectionTool } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { Collection, Pipeline } from "@/lib/types";
import type { CollectionTool } from "@/lib/types/tools";

type IndexesCardProps = {
  collection: Collection;
  token: string;
  /** Pipelines bound as tools, for the index slots each binding declares. */
  toolPipelines: Pipeline[];
  /** The collection's tool bindings, with their own index choices. */
  tools: CollectionTool[];
  onToolsChanged: () => void | Promise<void>;
};

/**
 * The one place a collection's indexes are chosen.
 *
 * Which index a collection reads and writes is a property of its bindings, so
 * it is answerable only here — the index registry owns index entities, never
 * where a collection points. The card states each slot's current index and
 * repoints every binding at once; a tool binding that must differ from the
 * rest is changed from its own row.
 */
export function IndexesCard({
  collection,
  token,
  toolPipelines,
  tools,
  onToolsChanged,
}: IndexesCardProps) {
  const slots = useApiQuery(
    () => fetchCollectionIndexes(token, collection.id),
    [token, collection.id],
  );
  const { registeredIndexes, refreshIndexes } = useIndexes(token);
  const [editing, setEditing] = useState(false);
  const [configuring, setConfiguring] = useState<CollectionTool | null>(null);

  const rows = slots.data?.slots ?? [];

  const pipelineById = useMemo(
    () => new Map(toolPipelines.map((pipeline) => [pipeline.id, pipeline])),
    [toolPipelines],
  );
  // Only bindings that declare an index slot: a tool with no slot has nothing
  // to change here, and listing it would suggest otherwise.
  const toolRows = useMemo(
    () =>
      tools
        .map((tool) => ({ tool, pipeline: pipelineById.get(tool.pipeline_id) ?? null }))
        .filter(
          (row): row is { tool: CollectionTool; pipeline: Pipeline } =>
            row.pipeline !== null &&
            indexVariables(row.pipeline.definition.variables ?? []).length > 0,
        ),
    [tools, pipelineById],
  );
  const configuringPipeline = configuring
    ? (pipelineById.get(configuring.pipeline_id) ?? null)
    : null;

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ui font-medium text-primary">Indexes</h2>
        {rows.length > 0 && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>
      {slots.error ? (
        <p className="mt-3 text-ui text-data-neg">{slots.error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-ui text-muted">
          {slots.loading ? "Loading…" : "The bound pipelines expose no index slots."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((slot) => (
            <li key={slot.name} className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="text-ui text-body">{slot.description || slot.name}</p>
                <p className="text-instrument text-meta">
                  {slot.name} · {slot.pipelines.join(", ")}
                </p>
              </div>
              <p className="font-mono text-instrument tabular-nums text-primary">
                {slot.current ? indexOptionLabel(slot.current) : "not set"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {toolRows.length > 0 ? (
        <div className="mt-4 border-t border-hairline pt-3">
          <InstrumentLabel>Per tool</InstrumentLabel>
          <ul className="mt-2 space-y-2">
            {toolRows.map(({ tool, pipeline }) => (
              <li key={tool.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-ui text-primary">{tool.name}</p>
                  <p className="truncate text-instrument text-meta">
                    {indexVariables(pipeline.definition.variables ?? [])
                      .map((slot) => {
                        const value = asIndexValue(tool.variable_values?.[slot.name] ?? slot.value);
                        return `${slot.name} → ${value?.name ?? "not set"}`;
                      })
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Change indexes for ${tool.name}`}
                  onClick={() => setConfiguring(tool)}
                >
                  Change
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <CollectionIndexesDialog
          collectionId={collection.id}
          token={token}
          slots={rows}
          indexes={registeredIndexes}
          onSaved={() => {
            setEditing(false);
            void slots.reload();
            void onToolsChanged();
          }}
          onIndexCreated={refreshIndexes}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {configuring && configuringPipeline ? (
        <BindingIndexDialog
          key={configuring.id}
          open
          pipeline={configuringPipeline}
          values={configuring.variable_values ?? {}}
          indexes={registeredIndexes}
          token={token}
          title={configuring.name}
          onIndexCreated={refreshIndexes}
          onSave={async (values) => {
            await updateCollectionTool(token, collection.id, configuring.id, {
              variable_values: values,
            });
            await onToolsChanged();
            void slots.reload();
          }}
          onClose={() => setConfiguring(null)}
        />
      ) : null}
    </Panel>
  );
}
