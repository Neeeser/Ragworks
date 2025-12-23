"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { PipelineKind } from "@/lib/types";

type PipelineHeaderProps = {
  onCreatePipeline: (kind: PipelineKind) => void;
};

export function PipelineHeader({ onCreatePipeline }: PipelineHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Pipelines</p>
        <h1 className="text-3xl font-semibold text-white">Design ingestion & retrieval flows.</h1>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => onCreatePipeline("ingestion")}>
          <Plus className="h-4 w-4" />
          New ingestion pipeline
        </Button>
        <Button onClick={() => onCreatePipeline("retrieval")}>
          <Plus className="h-4 w-4" />
          New retrieval pipeline
        </Button>
      </div>
    </div>
  );
}
