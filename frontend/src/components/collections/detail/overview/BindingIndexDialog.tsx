"use client";

import { useMemo, useState } from "react";

import { indexVariables } from "@/components/pipelines/lib/variable-env";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { getErrorMessage } from "@/lib/errors";

import { BindingIndexFields } from "./BindingIndexFields";

import type { Pipeline, VectorIndex } from "@/lib/types";

type BindingIndexDialogProps = {
  /** The pipeline whose binding variables this dialog fills in. */
  pipeline: Pipeline;
  /** The binding's current values, keyed by variable name. */
  values: Record<string, unknown>;
  /** Registered indexes the user can pick from. */
  indexes: VectorIndex[];
  token: string;
  /** Label for the thing being configured, shown in the heading. */
  title: string;
  open: boolean;
  busy?: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  /** Called after an index is created here, so the picker list reloads. */
  onIndexCreated: () => void;
  onClose: () => void;
};

/**
 * Repoint one binding's indexes.
 *
 * The warning is not decoration: an index change does not move data, so
 * whatever was already indexed stays where it was and the collection reads an
 * empty store until it is re-ingested. That outcome is invisible at query
 * time — retrieval just returns nothing — so it is stated before the change,
 * not after.
 */
export function BindingIndexDialog({
  pipeline,
  values,
  indexes,
  token,
  title,
  open,
  busy,
  onSave,
  onIndexCreated,
  onClose,
}: BindingIndexDialogProps) {
  const hasSlots = useMemo(
    () => indexVariables(pipeline.definition.variables ?? []).length > 0,
    [pipeline.definition.variables],
  );
  const [draft, setDraft] = useState<Record<string, unknown>>(values);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update this binding."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy="binding-index-dialog-title">
      <div className="card-surface w-full max-w-lg space-y-4 bg-canvas-raised p-4 text-primary shadow-elevation-2">
        <div className="space-y-1">
          <h2
            id="binding-index-dialog-title"
            className="text-head font-semibold tracking-[-0.01em] text-primary"
          >
            Indexes for {title}
          </h2>
          <p className="text-ui text-muted">
            Changing an index does not move indexed data. Re-ingest this collection to populate the
            new index.
          </p>
        </div>

        {hasSlots ? (
          <BindingIndexFields
            pipelines={[pipeline]}
            values={draft}
            indexes={indexes}
            token={token}
            disabled={busy || saving}
            onChange={setDraft}
            onIndexCreated={onIndexCreated}
          />
        ) : (
          // Said plainly rather than shown as an empty dialog: a pipeline
          // with no index slot is a legitimate shape, not a load failure.
          <p className="text-ui text-muted">This pipeline has no index to choose.</p>
        )}

        {error ? <p className="text-ui text-data-neg">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!hasSlots}>
            Save
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
