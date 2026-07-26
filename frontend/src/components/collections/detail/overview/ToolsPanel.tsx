"use client";

import { useMemo, useState } from "react";

import { BindingIndexDialog } from "@/components/collections/detail/overview/BindingIndexDialog";
import { PipelineSelect } from "@/components/collections/detail/overview/PipelineSelect";
import { useIndexes } from "@/components/pipelines/hooks/use-indexes";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import {
  addCollectionTool,
  fetchCollection,
  listCollectionTools,
  removeCollectionTool,
  updateCollectionTool,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";

import type { Collection, Pipeline } from "@/lib/types";
import type { CollectionTool } from "@/lib/types/tools";

type ToolsPanelProps = {
  collection: Collection;
  toolPipelines: Pipeline[];
  token: string;
  onCollectionUpdated: (collection: Collection) => void;
};

/** The collection's tool bindings: what chat exposes when this collection loads. */
export function ToolsPanel({
  collection,
  toolPipelines,
  token,
  onCollectionUpdated,
}: ToolsPanelProps) {
  const [pipelineToAdd, setPipelineToAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<CollectionTool | null>(null);
  const { registeredIndexes } = useIndexes(token);

  const tools = useApiQuery(() => listCollectionTools(token, collection.id), [token, collection]);
  const rows = useMemo(() => tools.data?.tools ?? [], [tools.data]);

  const unboundPipelines = useMemo(
    () =>
      toolPipelines.filter((pipeline) => !rows.some((tool) => tool.pipeline_id === pipeline.id)),
    [toolPipelines, rows],
  );

  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onCollectionUpdated(await fetchCollection(token, collection.id));
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update tools."));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!pipelineToAdd) return;
    await mutate(() => addCollectionTool(token, collection.id, { pipeline_id: pipelineToAdd }));
    setPipelineToAdd("");
  };

  const configuringPipeline = useMemo(
    () => toolPipelines.find((pipeline) => pipeline.id === configuring?.pipeline_id) ?? null,
    [toolPipelines, configuring],
  );

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ui font-medium text-primary">Tools</p>
        <p className="text-xs text-muted">
          Tools the model can call when this collection is loaded in chat.
        </p>
      </div>

      {rows.length === 0 && !tools.loading ? (
        <p className="mt-4 text-sm text-muted">No tools bound to this collection.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((tool: CollectionTool) => (
            <li
              key={tool.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-hairline bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-primary">{tool.name}</p>
                <p className="truncate text-xs text-muted">
                  {tool.pipeline_name} • returns {tool.output_kind}
                  {tool.is_primary ? " • primary search" : ""}
                  {tool.enabled ? "" : " • disabled"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!tool.is_primary && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      mutate(() =>
                        updateCollectionTool(token, collection.id, tool.id, {
                          is_primary: true,
                        }),
                      )
                    }
                  >
                    Make primary
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    mutate(() =>
                      updateCollectionTool(token, collection.id, tool.id, {
                        enabled: !tool.enabled,
                      }),
                    )
                  }
                >
                  {tool.enabled ? "Disable" : "Enable"}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfiguring(tool)}>
                  Indexes
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || tool.is_primary}
                  onClick={() => mutate(() => removeCollectionTool(token, collection.id, tool.id))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {unboundPipelines.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <p className="mb-1.5 text-instrument font-medium text-muted">Add tool</p>
            <PipelineSelect
              label="Pipeline to bind as a tool"
              pipelines={unboundPipelines}
              value={pipelineToAdd}
              onChange={setPipelineToAdd}
            />
          </div>
          <Button onClick={handleAdd} loading={busy} disabled={!pipelineToAdd}>
            Add
          </Button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {configuring && configuringPipeline ? (
        <BindingIndexDialog
          open
          pipeline={configuringPipeline}
          values={configuring.variable_values ?? {}}
          indexes={registeredIndexes}
          title={configuring.name}
          busy={busy}
          onSave={async (values) => {
            await updateCollectionTool(token, collection.id, configuring.id, {
              variable_values: values,
            });
            await tools.reload();
            onCollectionUpdated(await fetchCollection(token, collection.id));
          }}
          onClose={() => setConfiguring(null)}
        />
      ) : null}
    </Panel>
  );
}
