"use client";

import { useState } from "react";

import {
  indexOptionLabel,
  indexOptionsForSlot,
} from "@/components/collections/detail/overview/BindingIndexFields";
import { useIndexes } from "@/components/pipelines/hooks/use-indexes";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Panel } from "@/components/ui/panel";
import { createIndex, fetchCollectionIndexes, updateCollectionIndexes } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";

import type { Collection, CollectionIndexSlot, VectorIndex } from "@/lib/types";

type IndexesCardProps = {
  collection: Collection;
  token: string;
};

/**
 * The collection-level view of its index slots, and the one control that
 * repoints a slot across every binding at once. Changing an index moves no
 * data — the consequence is stated in the dialog, before the change, because
 * the empty reads it causes are invisible at query time.
 */
export function IndexesCard({ collection, token }: IndexesCardProps) {
  const slots = useApiQuery(
    () => fetchCollectionIndexes(token, collection.id),
    [token, collection.id],
  );
  const { registeredIndexes, refreshIndexes } = useIndexes(token);
  const [editing, setEditing] = useState(false);

  const rows = slots.data?.slots ?? [];

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ui font-medium text-primary">Indexes</h2>
        {rows.length > 0 && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>
      {slots.error ? (
        <p className="mt-3 text-ui text-data-neg">{slots.error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-ui text-muted">
          {slots.loading ? "Loading…" : "The bound pipelines expose no index slots."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((slot) => (
            <li key={slot.name} className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="text-ui text-body">{slot.description || slot.name}</p>
                <p className="text-instrument text-meta">
                  {slot.name} · {slot.pipelines.join(", ")}
                </p>
              </div>
              <p className="font-mono text-instrument tabular-nums text-primary">
                {slot.current ? indexOptionLabel(slot.current) : "not set"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <IndexesDialog
          collectionId={collection.id}
          token={token}
          slots={rows}
          indexes={registeredIndexes}
          onSaved={() => {
            setEditing(false);
            void slots.reload();
          }}
          onIndexCreated={refreshIndexes}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Panel>
  );
}

type IndexesDialogProps = {
  collectionId: string;
  token: string;
  slots: CollectionIndexSlot[];
  indexes: VectorIndex[];
  onSaved: () => void;
  onIndexCreated: () => void;
  onClose: () => void;
};

/** Repoint every slot in one save; selections apply to every binding. */
function IndexesDialog({
  collectionId,
  token,
  slots,
  indexes,
  onSaved,
  onIndexCreated,
  onClose,
}: IndexesDialogProps) {
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

/**
 * One slot's picker plus a quick-create for a compatible index. Creation is
 * offered only when the slot pins the parameters (vector type, and width for
 * dense slots) — a slot with an unknown width can't promise a compatible
 * index, so the Index Manager owns that case.
 */
function SlotEditor({
  slot,
  token,
  indexes,
  value,
  disabled,
  onPick,
  onIndexCreated,
}: SlotEditorProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const canCreate = slot.vector_type === "sparse" || slot.expected_dimension != null;
  const backend = slot.current?.backend ?? "pgvector";
  const widthLabel = slot.vector_type === "sparse" ? "BM25" : `${slot.expected_dimension}d`;

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createIndex(token, {
        backend,
        name: newName.trim(),
        vector_type: slot.vector_type,
        ...(slot.vector_type === "dense" && slot.expected_dimension != null
          ? { dimension: slot.expected_dimension, metric: slot.current?.metric ?? "cosine" }
          : {}),
      });
      onIndexCreated();
      if (created.index_id) onPick(created.index_id);
      setNewName("");
    } catch (err) {
      setCreateError(getErrorMessage(err, "Unable to create the index."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <Field label={slot.description || slot.name} hint={slot.name}>
        <CustomSelect
          value={value}
          options={indexOptionsForSlot(indexes, {
            vectorType: slot.vector_type,
            dimension: slot.expected_dimension,
          })}
          placeholder="Pick an index"
          disabled={disabled}
          onValueChange={onPick}
        />
      </Field>
      {canCreate ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={`New ${widthLabel} index on ${backend}`}>
              <TextInput
                value={newName}
                placeholder="new-index-name"
                disabled={disabled || creating}
                onChange={(event) => setNewName(event.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="secondary"
            loading={creating}
            disabled={disabled || newName.trim() === ""}
            onClick={handleCreate}
          >
            Create and use
          </Button>
        </div>
      ) : null}
      {createError ? <p className="text-ui text-data-neg">{createError}</p> : null}
    </div>
  );
}
