"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";

import { changeKindDot } from "./lib/change-kind";

import type { PendingChange } from "./lib/pipeline-diff";

type SaveVersionDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Material (non-layout) changes since the saved revision. */
  pendingChanges: PendingChange[];
  changeSummary: string;
  onChangeSummary: (value: string) => void;
  onSave: () => void;
  saving: boolean;
};

/**
 * Commit point for pipeline edits, opened from the top bar. Lists exactly what
 * will land in the new revision; node drags don't appear -- layout saves
 * itself in the background.
 */
export function SaveVersionDialog({
  open,
  onClose,
  pendingChanges,
  changeSummary,
  onChangeSummary,
  onSave,
  saving,
}: SaveVersionDialogProps) {
  const titleId = useId();
  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <GlassCard className="w-full max-w-lg rounded-[2rem] border border-hairline bg-canvas-raised/95 p-6">
        <p id={titleId} className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Save version
        </p>
        <ul className="mt-4 max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-hairline bg-surface px-3 py-2">
          {pendingChanges.map((change) => (
            <li
              key={`${change.kind}-${change.summary}`}
              className="flex items-start gap-2 text-xs text-body"
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${changeKindDot(change.kind)}`}
              />
              <span>{change.summary}</span>
            </li>
          ))}
        </ul>
        <input
          className="mt-3 w-full rounded-2xl border border-hairline bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent-violet"
          placeholder="Describe this revision (optional)"
          aria-label="Revision summary"
          value={changeSummary}
          onChange={(event) => onChangeSummary(event.target.value)}
        />
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={saving}>
            Save new revision
          </Button>
        </div>
      </GlassCard>
    </ModalOverlay>
  );
}
