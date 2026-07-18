"use client";

import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";

import type { PipelineVariable } from "@/lib/types";

type PatchProps = {
  variable: PipelineVariable;
  disabled?: boolean;
  onPatch: (patch: Partial<PipelineVariable>) => void;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

const NO_DEFAULT_OPTION = { value: "", label: "No default" };

/** Default/bounds/description/exposure for an input-source variable — the
 * caller contract lives here; the retrieval input node only picks names. */
export function InputVariableFields({ variable, disabled, onPatch }: PatchProps) {
  const numeric = variable.type === "integer" || variable.type === "number";
  return (
    <div className="space-y-3">
      <Field label="Description" hint="Shown to callers — the model reads it too.">
        <TextInput
          value={variable.description ?? ""}
          disabled={disabled}
          onChange={(event) => onPatch({ description: event.target.value })}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Default" hint="Empty = callers must supply it.">
          <InputDefaultControl variable={variable} disabled={disabled} onPatch={onPatch} />
        </Field>
        {numeric ? (
          <>
            <Field label="Min">
              <NumberOrEmptyInput
                value={variable.minimum ?? null}
                disabled={disabled}
                onChange={(minimum) => onPatch({ minimum })}
              />
            </Field>
            <Field label="Max">
              <NumberOrEmptyInput
                value={variable.maximum ?? null}
                disabled={disabled}
                onChange={(maximum) => onPatch({ maximum })}
              />
            </Field>
          </>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-xs text-body">
        <input
          type="checkbox"
          checked={variable.expose_to_llm ?? false}
          disabled={disabled}
          onChange={(event) => onPatch({ expose_to_llm: event.target.checked })}
        />
        Expose to model
      </label>
    </div>
  );
}

function InputDefaultControl({ variable, disabled, onPatch, ...controlProps }: PatchProps) {
  if (variable.type === "boolean") {
    return (
      <CustomSelect
        {...controlProps}
        value={variable.value === true ? "true" : variable.value === false ? "false" : ""}
        options={[
          NO_DEFAULT_OPTION,
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        placeholder="—"
        disabled={disabled}
        onValueChange={(value) => onPatch({ value: value === "" ? null : value === "true" })}
      />
    );
  }
  if (variable.type === "enum") {
    return (
      <CustomSelect
        {...controlProps}
        value={typeof variable.value === "string" ? variable.value : ""}
        options={[
          NO_DEFAULT_OPTION,
          ...(variable.choices ?? []).map((choice) => ({ value: choice, label: choice })),
        ]}
        placeholder="—"
        disabled={disabled}
        onValueChange={(value) => onPatch({ value: value === "" ? null : value })}
      />
    );
  }
  if (variable.type === "string") {
    return (
      <TextInput
        {...controlProps}
        value={typeof variable.value === "string" ? variable.value : ""}
        disabled={disabled}
        onChange={(event) => onPatch({ value: event.target.value || null })}
      />
    );
  }
  return (
    <NumberOrEmptyInput
      {...controlProps}
      value={typeof variable.value === "number" ? variable.value : null}
      disabled={disabled}
      onChange={(value) =>
        onPatch({
          value: value == null ? null : variable.type === "integer" ? Math.trunc(value) : value,
        })
      }
    />
  );
}

function NumberOrEmptyInput({
  value,
  disabled,
  onChange,
  ...controlProps
}: {
  value: number | null;
  disabled?: boolean;
  onChange: (value: number | null) => void;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  return (
    <TextInput
      {...controlProps}
      type="number"
      value={value == null ? "" : String(value)}
      disabled={disabled}
      className="font-mono text-[13px]"
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
    />
  );
}

/** The literal-value control for a constant (`source: "value"`) variable. */
export function ConstantValueField({ variable, disabled, onPatch }: PatchProps) {
  if (variable.type === "boolean") {
    return (
      <Field label="Value">
        <CustomSelect
          value={variable.value === true ? "true" : "false"}
          options={[
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
          placeholder="Value"
          disabled={disabled}
          onValueChange={(value) => onPatch({ value: value === "true" })}
        />
      </Field>
    );
  }
  if (variable.type === "enum") {
    return (
      <Field label="Value">
        <CustomSelect
          value={typeof variable.value === "string" ? variable.value : ""}
          options={(variable.choices ?? []).map((choice) => ({ value: choice, label: choice }))}
          placeholder="Pick a choice"
          disabled={disabled}
          onValueChange={(value) => onPatch({ value })}
        />
      </Field>
    );
  }
  const numeric = variable.type === "integer" || variable.type === "number";
  return (
    <Field label="Value">
      <TextInput
        type={numeric ? "number" : "text"}
        step={variable.type === "integer" ? 1 : undefined}
        value={variable.value == null ? "" : String(variable.value)}
        disabled={disabled}
        className={numeric ? "font-mono text-[13px]" : undefined}
        onChange={(event) => {
          if (!numeric) {
            onPatch({ value: event.target.value });
            return;
          }
          const raw = event.target.value;
          if (raw === "") {
            onPatch({ value: null });
            return;
          }
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) return;
          onPatch({ value: variable.type === "integer" ? Math.trunc(parsed) : parsed });
        }}
      />
    </Field>
  );
}
