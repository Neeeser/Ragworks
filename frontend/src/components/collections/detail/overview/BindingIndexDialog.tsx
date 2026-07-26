"use client";

import { useMemo, useState } from "react";

import { indexVariables } from "@/components/pipelines/lib/variable-env";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { getErrorMessage } from "@/lib/errors";

import type { IndexVariableValue, Pipeline, VectorIndex } from "@/lib/types";

type BindingIndexDialogProps = {
  /** The pipeline whose binding variables this dialog fills in. */
  pipeline: Pipeline;
  /** The binding's current values, keyed by variable name. */
  values: Record<string, unknown>;
  /** Registered indexes the user can pick from. */
  indexes: VectorIndex[];
  /** Label for the thing being configured, shown in the heading. */
  title: string;
  open: boolean;
  busy?: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
};

/** Read a stored binding value as an index reference, else null. */
function asIndexValue(value: unknown): IndexVariableValue | null {
  if (!value || typeof value !== "object" || !("index_id" in value)) return null;
  return value as IndexVariableValue;
}

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
  title,
  open,
  busy,
  onSave,
  onClose,
}: BindingIndexDialogProps) {
  const slots = useMemo(
    () => indexVariables(pipeline.definition.variables ?? []),
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

        {slots.length === 0 ? (
          <p className="text-ui text-muted">This pipeline has no index to choose.</p>
        ) : (
          <div className="space-y-3">
            {slots.map((slot) => {
              const current = asIndexValue(draft[slot.name] ?? slot.value);
              return (
                <Field key={slot.name} label={slot.description || slot.name} hint={slot.name}>
                  <CustomSelect
                    value={current?.index_id ?? ""}
                    options={indexes.map((index) => ({
                      value: index.index_id ?? "",
                      label: `${index.name} — ${index.backend}`,
                    }))}
                    placeholder="Pick an index"
                    disabled={busy || saving}
                    onValueChange={(indexId) => {
                      const picked = indexes.find((index) => index.index_id === indexId);
                      if (!picked?.index_id) return;
                      setDraft((previous) => ({
                        ...previous,
                        [slot.name]: {
                          index_id: picked.index_id,
                          backend: picked.backend,
                          name: picked.name,
                        },
                      }));
                    }}
                  />
                </Field>
              );
            })}
          </div>
        )}

        {error ? <p className="text-ui text-data-neg">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={slots.length === 0}>
            Save
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
