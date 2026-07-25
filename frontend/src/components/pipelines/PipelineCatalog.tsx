"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DataRow } from "@/components/ui/data-row";
import { StageStrip } from "@/components/ui/stage-strip";
import { Tooltip } from "@/components/ui/tooltip";

import { pipelineStages } from "./lib/pipeline-stages";

import type { Pipeline } from "@/lib/types";

type PipelineCatalogProps = {
  pipelines: Pipeline[];
  selectedPipelineId?: string;
  onSelect: (pipeline: Pipeline) => void;
  onDelete: (pipeline: Pipeline) => void;
  pipelineUsage: Set<string>;
};

/**
 * The pipelines in this kind, one row each inside the rail.
 *
 * The stage strip is derived from the saved definition, so it shows what the
 * graph actually does (parse → chunk → embed → index) rather than a label that
 * could drift from it; the version is a number, so it is mono.
 */
export function PipelineCatalog({
  pipelines,
  selectedPipelineId,
  onSelect,
  onDelete,
  pipelineUsage,
}: PipelineCatalogProps) {
  if (pipelines.length === 0) {
    return <p className="p-8 text-center text-ui text-muted">No pipelines in this kind yet.</p>;
  }

  return (
    <div>
      {pipelines.map((pipeline) => {
        const isInUse = pipelineUsage.has(pipeline.id);
        const stages = pipelineStages(pipeline.definition);
        return (
          <DataRow
            key={pipeline.id}
            selected={selectedPipelineId === pipeline.id}
            onSelect={() => onSelect(pipeline)}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{pipeline.name}</span>
                {pipeline.is_default ? (
                  <Chip tone="accent" dot={false}>
                    Default
                  </Chip>
                ) : null}
              </span>
            }
            subtitle={stages.length > 0 ? <StageStrip stages={stages} /> : undefined}
            columns={[
              <span
                key="version"
                className="w-8 shrink-0 text-right font-mono text-instrument tabular-nums text-meta"
              >
                v{pipeline.current_version}
              </span>,
            ]}
            actions={
              <Tooltip
                content={isInUse ? "Pipelines in use cannot be deleted." : "Delete pipeline"}
                side="left"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(pipeline)}
                  disabled={isInUse}
                  aria-label={`Delete ${pipeline.name}`}
                  className="hover:text-data-neg"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </Tooltip>
            }
          />
        );
      })}
    </div>
  );
}
