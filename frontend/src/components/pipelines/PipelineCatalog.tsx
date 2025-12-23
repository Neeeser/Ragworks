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
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Layers className="h-4 w-4 text-violet-300" />
        Pipeline catalog
      </div>
      <div className="mt-4 space-y-3">
        {pipelines.length === 0 && (
          <p className="text-sm text-slate-400">No pipelines yet. Create one above.</p>
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
                  ? "border-violet-400 bg-violet-500/10 text-white"
                  : "border-white/5 bg-white/5 text-slate-300 hover:border-white/20",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(pipeline)}
                className={cn(
                  "flex-1 rounded-xl px-2 py-1 text-left",
                  isSelected ? "text-white" : "text-slate-300 group-hover:text-white",
                )}
              >
                <p className="font-semibold">{pipeline.name}</p>
                <p
                  className={cn(
                    "text-xs",
                    isSelected ? "text-slate-300" : "text-slate-400 group-hover:text-slate-200",
                  )}
                >
                  {pipeline.kind} • v{pipeline.current_version}
                </p>
              </button>
              <Tooltip content={isInUse ? "Pipelines in use cannot be deleted." : ""} side="left">
                <button
                  type="button"
                  onClick={() => onDelete(pipeline)}
                  disabled={isInUse}
                  aria-label={`Delete ${pipeline.name}`}
                  className={cn(
                    "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border text-slate-400 transition",
                    isSelected
                      ? "border-white/20 hover:border-rose-300/60 hover:text-rose-300"
                      : "border-white/10 hover:border-rose-300/60 hover:text-rose-300",
                    isInUse && "cursor-not-allowed border-white/10 text-slate-600",
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
