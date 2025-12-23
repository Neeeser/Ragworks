"use client";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";

import type { PipelineVersion } from "@/lib/types";

type PipelineRevisionsProps = {
  versions: PipelineVersion[];
  currentVersion?: number;
  saving: boolean;
  onActivate: (version: PipelineVersion) => void;
};

export function PipelineRevisions({
  versions,
  currentVersion,
  saving,
  onActivate,
}: PipelineRevisionsProps) {
  return (
    <GlassCard className="rounded-3xl p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Revisions</p>
      <div className="mt-3 space-y-3 text-sm">
        {versions.length === 0 && <p className="text-sm text-slate-400">No revisions loaded.</p>}
        {versions.map((version) => {
          const isCurrent = currentVersion === version.version;
          return (
            <div
              key={version.id}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">v{version.version}</p>
                  <p className="text-xs text-slate-400">
                    {version.change_summary || "No summary provided."}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={isCurrent ? "secondary" : "ghost"}
                  disabled={isCurrent || saving}
                  onClick={() => onActivate(version)}
                >
                  {isCurrent ? "Active" : "Activate"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
