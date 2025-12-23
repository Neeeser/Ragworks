"use client";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";

type PipelineSavePanelProps = {
  changeSummary: string;
  onChangeSummary: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  validating: boolean;
};

export function PipelineSavePanel({
  changeSummary,
  onChangeSummary,
  onSave,
  saving,
  validating,
}: PipelineSavePanelProps) {
  return (
    <GlassCard className="rounded-3xl p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Save version</p>
      <div className="mt-3 space-y-3">
        <input
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
          placeholder="Change summary"
          value={changeSummary}
          onChange={(event) => onChangeSummary(event.target.value)}
        />
        <Button onClick={onSave} loading={saving || validating}>
          Save pipeline
        </Button>
      </div>
    </GlassCard>
  );
}
