"use client";

import { Button } from "@/components/ui/button";
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
    <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-300">
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
          className="h-4 w-4 rounded border-white/30 bg-transparent"
          checked={value === true}
          disabled={locked}
          onChange={(event) => onChange(event.target.checked)}
        />
      </Field>
    );
  }

  if (field.kind === "int") {
    return (
      <Field label={field.label} hint={field.description} labelEnd={labelEnd}>
        <TextInput
          type="number"
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
