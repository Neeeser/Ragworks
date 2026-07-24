"use client";

import { Layers, Trash2 } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { Pipeline } from "@/lib/types";

type PipelineCatalogProps = {
  pipelines: Pipeline[];
  selectedPipelineId?: string;
  onSelect: (pipeline: Pipeline) => void;
  onDelete: (pipeline: Pipeline) => void;
  pipelineUsage: Set<string>;
};

export function PipelineCatalog({
  pipelines,
  selectedPipelineId,
  onSelect,
  onDelete,
  pipelineUsage,
}: PipelineCatalogProps) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Layers className="h-4 w-4 text-accent-violet" />
        Pipeline catalog
      </div>
      <div className="mt-4 space-y-3">
        {pipelines.length === 0 && (
          <p className="text-sm text-muted">No pipelines yet. Create one above.</p>
        )}
        {pipelines.map((pipeline) => {
          const isSelected = selectedPipelineId === pipeline.id;
          const isInUse = pipelineUsage.has(pipeline.id);
          return (
            <div
              key={pipeline.id}
              className={cn(
                "group flex items-center gap-2 rounded-2xl border px-2 py-2 text-sm transition",
                isSelected
                  ? "border-accent-violet bg-accent-violet/10 text-primary"
                  : "border-hairline bg-surface text-body hover:border-strong",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(pipeline)}
                className={cn(
                  "flex-1 rounded-xl px-2 py-1 text-left",
                  isSelected ? "text-primary" : "text-body group-hover:text-primary",
                )}
              >
                <p className="font-semibold">{pipeline.name}</p>
                <p
                  className={cn(
                    "text-xs",
                    isSelected ? "text-body" : "text-muted group-hover:text-body",
                  )}
                >
                  {pipeline.kind ?? "custom"} • v{pipeline.current_version}
                </p>
              </button>
              <Tooltip content={isInUse ? "Pipelines in use cannot be deleted." : ""} side="left">
                <button
                  type="button"
                  onClick={() => onDelete(pipeline)}
                  disabled={isInUse}
                  aria-label={`Delete ${pipeline.name}`}
                  className={cn(
                    "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border text-muted transition",
                    isSelected
                      ? "border-strong hover:border-data-neg/60 hover:text-data-neg"
                      : "border-hairline hover:border-data-neg/60 hover:text-data-neg",
                    isInUse && "cursor-not-allowed border-hairline text-faint",
                  )}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
