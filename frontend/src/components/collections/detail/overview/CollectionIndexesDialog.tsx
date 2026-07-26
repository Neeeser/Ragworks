"use client";

import { useState } from "react";

import { indexOptionsForSlot } from "@/components/collections/detail/overview/BindingIndexFields";
import { canCreateForSlot, InlineIndexCreate } from "@/components/indexes/InlineIndexCreate";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { updateCollectionIndexes } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAppConfig } from "@/providers/config-provider";

import type { IndexSlotConstraint } from "@/components/pipelines/lib/variable-env";
import type { CollectionIndexSlot, VectorIndex } from "@/lib/types";

type CollectionIndexesDialogProps = {
  collectionId: string;
  token: string;
  slots: CollectionIndexSlot[];
  indexes: VectorIndex[];
  onSaved: () => void;
  onIndexCreated: () => void;
  onClose: () => void;
};

/**
 * Repoint every slot in one save; selections apply to every binding that
 * declares the slot, because ingestion must write where retrieval reads.
 *
 * The consequence is stated before the change, not after: an index swap moves
 * no data, so the collection reads an empty store until it is re-ingested —
 * and that outcome is invisible at query time, since retrieval simply returns
 * nothing.
 */
export function CollectionIndexesDialog({
  collectionId,
  token,
  slots,
  indexes,
  onSaved,
  onIndexCreated,
  onClose,
}: CollectionIndexesDialogProps) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      slots
        .filter((slot) => slot.current !== null)
        .map((slot) => [slot.name, slot.current?.index_id ?? ""]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const values = Object.fromEntries(
        Object.entries(draft).map(([name, indexId]) => [name, { index_id: indexId }]),
      );
      await updateCollectionIndexes(token, collectionId, values);
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update the collection's indexes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay open onClose={onClose} labelledBy="collection-indexes-title">
      <div className="card-surface w-full max-w-lg space-y-4 bg-canvas-raised p-4 text-primary shadow-elevation-2">
        <div className="space-y-1">
          <h2
            id="collection-indexes-title"
            className="text-head font-semibold tracking-[-0.01em] text-primary"
          >
            Collection indexes
          </h2>
          <p className="text-ui text-muted">
            A change applies to every pipeline bound to this collection. Changing an index does not
            move indexed data — re-ingest to populate the new index.
          </p>
        </div>

        <div className="space-y-4">
          {slots.map((slot) => (
            <SlotEditor
              key={slot.name}
              slot={slot}
              token={token}
              indexes={indexes}
              value={draft[slot.name] ?? ""}
              disabled={saving}
              onPick={(indexId) => setDraft((prev) => ({ ...prev, [slot.name]: indexId }))}
              onIndexCreated={onIndexCreated}
            />
          ))}
        </div>

        {error ? <p className="text-ui text-data-neg">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

type SlotEditorProps = {
  slot: CollectionIndexSlot;
  token: string;
  indexes: VectorIndex[];
  value: string;
  disabled?: boolean;
  onPick: (indexId: string) => void;
  onIndexCreated: () => void;
};

/** One slot's picker plus the inline create for a compatible index. */
function SlotEditor({
  slot,
  token,
  indexes,
  value,
  disabled,
  onPick,
  onIndexCreated,
}: SlotEditorProps) {
  const { config: appConfig } = useAppConfig();
  const constraint: IndexSlotConstraint = {
    vectorType: slot.vector_type,
    dimension: slot.expected_dimension,
  };

  return (
    <div className="space-y-2">
      <Field label={slot.description || slot.name} hint={slot.name}>
        <CustomSelect
          value={value}
          options={indexOptionsForSlot(indexes, constraint)}
          placeholder="Pick an index"
          disabled={disabled}
          onValueChange={onPick}
        />
      </Field>
      {canCreateForSlot(constraint.vectorType, constraint.dimension) ? (
        <InlineIndexCreate
          token={token}
          backend={slot.current?.backend ?? appConfig.indexing.default_backend}
          vectorType={constraint.vectorType}
          dimension={constraint.dimension}
          metric={slot.current?.metric}
          disabled={disabled}
          onCreated={(created) => {
            onIndexCreated();
            if (created.index_id) onPick(created.index_id);
          }}
        />
      ) : null}
    </div>
  );
}
