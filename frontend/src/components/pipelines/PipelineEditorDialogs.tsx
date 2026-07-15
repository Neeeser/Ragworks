"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { RevisionHistoryDialog } from "./RevisionHistoryDialog";
import { SaveVersionDialog } from "./SaveVersionDialog";

import type { PendingChange } from "./lib/pipeline-diff";
import type { PipelineValidationIssue, PipelineVersion } from "@/lib/types";

type PipelineEditorDialogsProps = {
  saveOpen: boolean;
  onCloseSave: () => void;
  pendingChanges: PendingChange[];
  changeSummary: string;
  onChangeSummary: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  validationMessage: string | null;
  validationIssues: PipelineValidationIssue[];
  historyOpen: boolean;
  onCloseHistory: () => void;
  versions: PipelineVersion[];
  currentVersion?: number;
  activating: boolean;
  onActivate: (version: PipelineVersion) => void;
  discardOpen: boolean;
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
};

/** The top-bar dialogs of the pipeline editor: save version, revision history,
 * and the discard-unsaved-changes prompt. Pure composition -- all state lives
 * in PipelineBuilder. */
export function PipelineEditorDialogs({
  saveOpen,
  onCloseSave,
  pendingChanges,
  changeSummary,
  onChangeSummary,
  onSave,
  saving,
  validationMessage,
  validationIssues,
  historyOpen,
  onCloseHistory,
  versions,
  currentVersion,
  activating,
  onActivate,
  discardOpen,
  onConfirmDiscard,
  onCancelDiscard,
}: PipelineEditorDialogsProps) {
  return (
    <>
      <SaveVersionDialog
        open={saveOpen}
        onClose={onCloseSave}
        pendingChanges={pendingChanges}
        changeSummary={changeSummary}
        onChangeSummary={onChangeSummary}
        onSave={onSave}
        saving={saving}
        validationMessage={validationMessage}
        validationIssues={validationIssues}
      />
      <RevisionHistoryDialog
        open={historyOpen}
        onClose={onCloseHistory}
        versions={versions}
        currentVersion={currentVersion}
        saving={activating}
        onActivate={onActivate}
      />
      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        description={`${pendingChanges.length} unsaved ${
          pendingChanges.length === 1 ? "change" : "changes"
        } will be lost.`}
        confirmLabel="Discard"
        confirmVariant="danger"
        onConfirm={onConfirmDiscard}
        onCancel={onCancelDiscard}
      />
    </>
  );
}
