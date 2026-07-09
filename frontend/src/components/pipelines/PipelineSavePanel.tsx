"use client";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";

import { changeKindDot } from "./lib/change-kind";

import type { PendingChange } from "./lib/pipeline-diff";

type PipelineSavePanelProps = {
  changeSummary: string;
  onChangeSummary: (value: string) => void;
  /** Material (non-layout) changes since the saved revision. */
  pendingChanges: PendingChange[];
  onSave: () => void;
  saving: boolean;
  validating: boolean;
};

/**
 * Commit point for pipeline edits. Lists exactly what will land in the new
 * revision; with nothing pending the button disables ("no empty revisions" is
 * also enforced server-side). Node drags don't appear here -- layout saves
 * itself in the background.
 */
export function PipelineSavePanel({
  changeSummary,
  onChangeSummary,
  pendingChanges,
  onSave,
  saving,
  validating,
}: PipelineSavePanelProps) {
  const hasChanges = pendingChanges.length > 0;
  return (
    <GlassCard className="rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Save version</p>
        {hasChanges ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
            {pendingChanges.length} unsaved {pendingChanges.length === 1 ? "change" : "changes"}
          </span>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">
        {hasChanges ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
            {pendingChanges.map((change) => (
              <li
                key={`${change.kind}-${change.summary}`}
                className="flex items-start gap-2 text-xs text-slate-300"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${changeKindDot(change.kind)}`}
                />
                <span>{change.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-500">
            Everything is saved. Edit a node or connection to create a new revision; moving nodes
            around saves by itself.
          </p>
        )}
        <input
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
          placeholder="Describe this revision (optional)"
          value={changeSummary}
          onChange={(event) => onChangeSummary(event.target.value)}
          disabled={!hasChanges}
        />
        <Button onClick={onSave} loading={saving || validating} disabled={!hasChanges}>
          Save new revision
        </Button>
      </div>
    </GlassCard>
  );
}
