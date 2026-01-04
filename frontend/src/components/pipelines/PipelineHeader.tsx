"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PIPELINE_KINDS } from "./pipeline-kinds";

import type { PipelineKind } from "@/lib/types";

type PipelineHeaderProps = {
  kind: PipelineKind;
  onCreatePipeline: () => void;
};

export function PipelineHeader({ kind, onCreatePipeline }: PipelineHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Pipelines</p>
        <h1 className="text-3xl font-semibold text-white">
          {kind === "ingestion" ? "Build ingestion flows." : "Design retrieval flows."}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {PIPELINE_KINDS.map((value) => (
            <Link
              key={value}
              href={`/pipelines/${value}`}
              className={cn(
                "rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.35em] transition",
                value === kind
                  ? "border-white/40 bg-white/10 text-white"
                  : "text-slate-400 hover:border-white/30 hover:text-white",
              )}
            >
              {value}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={onCreatePipeline}>
          <Plus className="h-4 w-4" />
          {kind === "ingestion" ? "New ingestion pipeline" : "New retrieval pipeline"}
        </Button>
      </div>
    </div>
  );
}
