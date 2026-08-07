"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ModalOverlay } from "@/components/ui/modal-overlay";

import { changeKindDot } from "./lib/change-kind";
import { NodeValidationMessages } from "./NodeValidationMessages";

import type { PendingChange } from "./lib/pipeline-diff";
import type { SaveBlockerGroup } from "./lib/save-blockers";
import type { PipelineValidationIssue } from "@/lib/types";

type SaveVersionDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Material (non-layout) changes since the saved revision. */
  pendingChanges: PendingChange[];
  changeSummary: string;
  onChangeSummary: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  validationMessage?: string | null;
  validationIssues?: PipelineValidationIssue[];
  /** Findings that would fail the save, grouped by the node they name. */
  blockers?: SaveBlockerGroup[];
};

/**
 * Commit point for pipeline edits, opened from the top bar. Lists exactly what
 * will land in the new revision; node drags don't appear -- layout saves
 * itself in the background.
 *
 * An invalid graph opens this dialog on its blocking findings rather than
 * refusing to open: a save button that answers nothing leaves the user with no
 * way to learn what is wrong.
 */
export function SaveVersionDialog({
  open,
  onClose,
  pendingChanges,
  changeSummary,
  onChangeSummary,
  onSave,
  saving,
  validationMessage,
  validationIssues = [],
  blockers = [],
}: SaveVersionDialogProps) {
  const titleId = useId();
  const blocked = blockers.length > 0;
  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <div className="card-surface w-full max-w-lg bg-canvas-raised p-4 shadow-elevation-2">
        <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
          Save version
        </h2>
        {validationMessage ? (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-3 rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
          >
            <p className="max-w-[66ch]">{validationMessage}</p>
            {validationIssues.some((issue) => issue.field) ? (
              <ul aria-label="Validation issues" className="mt-2 space-y-1">
                {validationIssues
                  .filter((issue) => issue.field)
                  .map((issue) => (
                    <li key={`${issue.node_id ?? "pipeline"}-${issue.field}-${issue.message}`}>
                      {/* The field key is an identifier; the message is prose. */}
                      <span className="font-mono">{issue.field}</span>: {issue.message}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {blocked ? (
          <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
            <p className="text-ui text-data-neg">Saving is blocked until these are fixed.</p>
            {blockers.map((group) => (
              <div key={group.nodeId ?? "pipeline"} className="space-y-1">
                <InstrumentLabel>{group.label}</InstrumentLabel>
                <NodeValidationMessages
                  errors={group.errors}
                  issues={group.issues}
                  includeFieldIssues
                />
              </div>
            ))}
          </div>
        ) : null}
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-control border border-hairline bg-surface px-3 py-2">
          {pendingChanges.map((change) => (
            <li
              key={`${change.kind}-${change.summary}`}
              className="flex items-start gap-2 text-ui text-body"
            >
              {/* A square node dot, coloured by what the change did. */}
              <span
                aria-hidden
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-[2px] ${changeKindDot(change.kind)}`}
              />
              <span>{change.summary}</span>
            </li>
          ))}
        </ul>
        <TextInput
          className="mt-2"
          placeholder="Describe this revision (optional)"
          aria-label="Revision summary"
          value={changeSummary}
          onChange={(event) => onChangeSummary(event.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button glow={!blocked} onClick={onSave} loading={saving} disabled={blocked}>
            Save new revision
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
