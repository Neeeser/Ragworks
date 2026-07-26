"use client";

import { useMemo } from "react";

import { indexVariables } from "@/components/pipelines/lib/variable-env";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field } from "@/components/ui/field";

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

  if (slots.length === 0) return null;

  return (
    <div className="space-y-3">
      {slots.map((slot) => {
        const current = asIndexValue(values[slot.name] ?? slot.value);
        return (
          <Field key={slot.name} label={slot.description || slot.name} hint={slot.name}>
            <CustomSelect
              value={current?.index_id ?? ""}
              options={indexes.map((index) => ({
                value: index.index_id ?? "",
                label: `${index.name} — ${index.backend}`,
              }))}
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
