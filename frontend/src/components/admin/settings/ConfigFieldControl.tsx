"use client";

import { Button } from "@/components/ui/button";
import { CheckboxBox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextArea, TextInput } from "@/components/ui/field";

import type { ConfigFieldRead } from "@/lib/types";

/**
 * Controls stop well short of the full-bleed card: a text input stretched
 * across a 1600px viewport is unusable, and the label above it becomes
 * unreadably far from its value.
 */
const FIELD_WIDTH = "max-w-xl";

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
    // The pin is a fact about where the value comes from, so it wears the
    // console's pill voice rather than a hand-rolled badge.
    <Chip dot={false}>{`Pinned by ${field.env_var}`}</Chip>
  ) : field.source === "db" ? (
    <Button size="sm" variant="ghost" loading={resetting} onClick={onReset}>
      Reset to default
    </Button>
  ) : undefined;

  if (field.kind === "bool") {
    return (
      <Field
        label={field.label}
        hint={field.description}
        labelEnd={labelEnd}
        className={FIELD_WIDTH}
      >
        <CheckboxBox checked={value === true} disabled={locked} onChange={onChange} />
      </Field>
    );
  }

  if (field.kind === "int") {
    return (
      <Field
        label={field.label}
        hint={numericHint(field)}
        labelEnd={labelEnd}
        className={FIELD_WIDTH}
      >
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
      <Field
        label={field.label}
        hint={field.description}
        labelEnd={labelEnd}
        className={FIELD_WIDTH}
      >
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
      <Field
        label={field.label}
        hint={field.description}
        labelEnd={labelEnd}
        className={FIELD_WIDTH}
      >
        <div role="group" aria-label={field.label} className="space-y-2">
          {options.map((option) => {
            const checked = selected.has(option.value);
            return (
              <label key={option.value} className="flex items-center gap-2 text-ui text-body">
                <CheckboxBox
                  checked={checked}
                  disabled={locked}
                  onChange={(isChecked) => {
                    const next = new Set(selected);
                    if (isChecked) {
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
      <Field
        label={field.label}
        hint={field.description}
        labelEnd={labelEnd}
        className={FIELD_WIDTH}
      >
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
    <Field label={field.label} hint={field.description} labelEnd={labelEnd} className={FIELD_WIDTH}>
      <TextInput
        type="text"
        value={typeof value === "string" ? value : ""}
        disabled={locked}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
