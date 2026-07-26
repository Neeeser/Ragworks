"use client";

import { useMemo } from "react";

import { indexSlotConstraints, indexVariables } from "@/components/pipelines/lib/variable-env";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field } from "@/components/ui/field";

import type { IndexSlotConstraint } from "@/components/pipelines/lib/variable-env";
import type { IndexVariableValue, Pipeline, VectorIndex } from "@/lib/types";

type BindingIndexFieldsProps = {
  /** Pipelines whose index slots are being filled — the union is rendered. */
  pipelines: Pipeline[];
  /** Current selections, keyed by variable name. */
  values: Record<string, unknown>;
  indexes: VectorIndex[];
  disabled?: boolean;
  onChange: (values: Record<string, unknown>) => void;
};

/** Read a stored binding value as an index reference, else null. */
export function asIndexValue(value: unknown): IndexVariableValue | null {
  if (!value || typeof value !== "object" || !("index_id" in value)) return null;
  return value as IndexVariableValue;
}

/** A picker label carrying the facts a choice hinges on: backend and width. */
export function indexOptionLabel(index: {
  name: string;
  backend: string;
  dimension?: number | null;
  vector_type?: string | null;
}): string {
  const width = index.vector_type === "sparse" ? "sparse" : `${index.dimension ?? "?"}d`;
  return `${index.name} — ${index.backend} · ${width}`;
}

/**
 * The selectable options for one slot: only indexes of the slot's vector
 * type, with wrong-width dense indexes shown disabled and labeled with why —
 * hiding them would read as "the index is gone" rather than "incompatible".
 * The server re-validates on save; this mirrors that check, not replaces it.
 */
export function indexOptionsForSlot(
  indexes: VectorIndex[],
  constraint: { vectorType: string; dimension: number | null },
): Array<{ value: string; label: string; disabled?: boolean }> {
  return indexes
    .filter((index) => (index.vector_type ?? "dense") === constraint.vectorType)
    .map((index) => {
      const mismatch =
        constraint.vectorType === "dense" &&
        constraint.dimension != null &&
        index.dimension != null &&
        index.dimension !== constraint.dimension;
      return {
        value: index.index_id ?? "",
        label: mismatch
          ? `${indexOptionLabel(index)} (needs ${constraint.dimension}d)`
          : indexOptionLabel(index),
        disabled: mismatch,
      };
    });
}

/**
 * One picker per index slot the given pipelines expose.
 *
 * Slots are keyed by variable name across pipelines, so an ingestion and a
 * retrieval pipeline that both read `primary_index` render one control. That
 * is deliberate: ingestion must write where retrieval reads, and offering two
 * controls is how a collection ends up indexing into one store and querying
 * another.
 */
export function BindingIndexFields({
  pipelines,
  values,
  indexes,
  disabled,
  onChange,
}: BindingIndexFieldsProps) {
  const slots = useMemo(() => {
    const byName = new Map<string, ReturnType<typeof indexVariables>[number]>();
    for (const pipeline of pipelines) {
      for (const slot of indexVariables(pipeline.definition.variables ?? [])) {
        if (!byName.has(slot.name)) byName.set(slot.name, slot);
      }
    }
    return [...byName.values()];
  }, [pipelines]);

  const constraints = useMemo(() => indexSlotConstraints(pipelines), [pipelines]);

  if (slots.length === 0) return null;

  return (
    <div className="space-y-3">
      {slots.map((slot) => {
        const current = asIndexValue(values[slot.name] ?? slot.value);
        const constraint: IndexSlotConstraint = constraints.get(slot.name) ?? {
          vectorType: "dense",
          dimension: null,
        };
        // The bind-time anchor falls back to the currently selected index's
        // own width when the definition states none.
        const anchored: IndexSlotConstraint =
          constraint.dimension == null && constraint.vectorType === "dense"
            ? {
                ...constraint,
                dimension:
                  indexes.find((index) => index.index_id === current?.index_id)?.dimension ?? null,
              }
            : constraint;
        return (
          <Field key={slot.name} label={slot.description || slot.name} hint={slot.name}>
            <CustomSelect
              value={current?.index_id ?? ""}
              options={indexOptionsForSlot(indexes, anchored)}
              placeholder="Pick an index"
              disabled={disabled}
              onValueChange={(indexId) => {
                const picked = indexes.find((index) => index.index_id === indexId);
                if (!picked?.index_id) return;
                onChange({
                  ...values,
                  [slot.name]: {
                    index_id: picked.index_id,
                    backend: picked.backend,
                    name: picked.name,
                  },
                });
              }}
            />
          </Field>
        );
      })}
    </div>
  );
}
