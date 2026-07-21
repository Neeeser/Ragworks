"use client";

import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextArea, TextInput } from "@/components/ui/field";

import type { ConfigFieldRead } from "@/lib/types";

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseStringList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function numericHint(field: ConfigFieldRead): string {
  if (field.min_value == null && field.max_value == null) {
    return field.description;
  }
  const range =
    field.min_value != null && field.max_value != null
      ? `${field.min_value}–${field.max_value}`
      : (field.min_value ?? field.max_value)?.toString();
  return `${field.description} Allowed range: ${range}.`;
}

type ConfigFieldControlProps = {
  field: ConfigFieldRead;
  value: unknown;
  onChange: (value: unknown) => void;
  onReset: () => void;
  resetting: boolean;
};

/** Renders one config catalog entry as an editable control, dispatched by `kind`. */
export function ConfigFieldControl({
  field,
  value,
  onChange,
  onReset,
  resetting,
}: ConfigFieldControlProps) {
  const locked = field.source === "env-locked";

  const labelEnd = locked ? (
    <span className="rounded-full bg-surface-strong px-2.5 py-1 text-xs font-medium text-muted">
      Pinned by {field.env_var}
    </span>
  ) : field.source === "db" ? (
    <Button size="sm" variant="ghost" loading={resetting} onClick={onReset}>
      Reset to default
    </Button>
  ) : undefined;

  if (field.kind === "bool") {
    return (
      <Field label={field.label} hint={field.description} labelEnd={labelEnd}>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-strong bg-transparent accent-accent-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          checked={value === true}
          disabled={locked}
          onChange={(event) => onChange(event.target.checked)}
        />
      </Field>
    );
  }

  if (field.kind === "int") {
    return (
      <Field label={field.label} hint={numericHint(field)} labelEnd={labelEnd}>
        <TextInput
          type="number"
          min={field.min_value ?? undefined}
          max={field.max_value ?? undefined}
          value={typeof value === "number" ? value : ""}
          disabled={locked}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw.trim() === "") {
              return;
            }
            const parsed = Number(raw);
            if (Number.isNaN(parsed)) {
              return;
            }
            onChange(parsed);
          }}
        />
      </Field>
    );
  }

  if (field.kind === "select") {
    const options = field.options ?? [];
    return (
      <Field label={field.label} hint={field.description} labelEnd={labelEnd}>
        <CustomSelect
          value={typeof value === "string" ? value : ""}
          options={options.map((option) => ({ value: option.value, label: option.label }))}
          placeholder="Select a value"
          disabled={locked}
          onValueChange={onChange}
        />
      </Field>
    );
  }

  if (field.kind === "multi_select") {
    const options = field.options ?? [];
    const selected = new Set(toStringList(value));
    return (
      <Field label={field.label} hint={field.description} labelEnd={labelEnd}>
        <div role="group" aria-label={field.label} className="space-y-2">
          {options.map((option) => {
            const checked = selected.has(option.value);
            return (
              <label key={option.value} className="flex items-center gap-2 text-sm text-body">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-strong bg-transparent accent-accent-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  checked={checked}
                  disabled={locked}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) {
                      next.add(option.value);
                    } else {
                      next.delete(option.value);
                    }
                    onChange(Array.from(next));
                  }}
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </Field>
    );
  }

  if (field.kind === "string_list") {
    return (
      <Field label={field.label} hint={field.description} labelEnd={labelEnd}>
        <TextArea
          rows={4}
          value={toStringList(value).join("\n")}
          disabled={locked}
          onChange={(event) => onChange(parseStringList(event.target.value))}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label} hint={field.description} labelEnd={labelEnd}>
      <TextInput
        type="text"
        value={typeof value === "string" ? value : ""}
        disabled={locked}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
