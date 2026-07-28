"use client";

import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { ProviderConfigField } from "@/lib/types";

interface ConnectionConfigFieldsProps {
  fields: ProviderConfigField[];
  config: Record<string, string>;
  onChange: (name: string, value: string) => void;
  /** Secret fields already configured on the connection being edited. */
  secretsConfigured?: Record<string, boolean>;
}

/** Config values travel as strings; a boolean field stores its two spellings. */
export const TRUE_VALUE = "true";

export function isFieldEnabled(config: Record<string, string>, field: ProviderConfigField) {
  const stored = config[field.name];
  if (stored === undefined) return field.default === true;
  return stored === TRUE_VALUE;
}

/**
 * The provider config form, rendered from the type's `config_fields` catalog —
 * shared by the add and edit dialogs so a new provider type needs zero new
 * form code. When editing, a configured secret shows a keep-current hint
 * instead of demanding re-entry.
 *
 * Fields marked `advanced` sit behind a disclosure: a custom server needs a
 * URL and maybe a key, and putting its dialect and endpoint-path overrides in
 * the same column would make the common case look like the hard one.
 */
export function ConnectionConfigFields({
  fields,
  config,
  onChange,
  secretsConfigured,
}: ConnectionConfigFieldsProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const primary = fields.filter((field) => !field.advanced);
  const advanced = fields.filter((field) => field.advanced);

  const renderField = (field: ProviderConfigField) => {
    if (field.kind === "boolean") {
      return (
        <Checkbox
          key={field.name}
          checked={isFieldEnabled(config, field)}
          onChange={(checked) => onChange(field.name, checked ? TRUE_VALUE : "false")}
          label={field.label}
          description={field.description ?? undefined}
        />
      );
    }

    const value = config[field.name] ?? (typeof field.default === "string" ? field.default : "");

    if (field.kind === "select") {
      return (
        <Field key={field.name} label={field.label} hint={field.description ?? undefined}>
          <CustomSelect
            value={value}
            placeholder="Select…"
            options={field.options.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            onValueChange={(next) => onChange(field.name, next)}
          />
        </Field>
      );
    }

    const secretKept = field.kind === "secret" && secretsConfigured?.[field.name];
    return (
      <Field
        key={field.name}
        label={field.label}
        labelEnd={
          field.kind === "secret" ? (
            <button
              type="button"
              aria-label={`${revealed[field.name] ? "Hide" : "Show"} secret: ${field.name}`}
              aria-pressed={revealed[field.name] ?? false}
              onClick={() =>
                setRevealed((current) => ({
                  ...current,
                  [field.name]: !current[field.name],
                }))
              }
              className="rounded-control p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {revealed[field.name] ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          ) : undefined
        }
        hint={
          secretKept
            ? "Configured — leave blank to keep the current value."
            : (field.description ?? (field.required ? undefined : "Optional."))
        }
      >
        <TextInput
          type={field.kind === "secret" && !revealed[field.name] ? "password" : "text"}
          placeholder={secretKept ? "••••••••" : (field.placeholder ?? undefined)}
          value={value}
          onChange={(event) => onChange(field.name, event.target.value)}
        />
      </Field>
    );
  };

  return (
    <>
      {primary.map(renderField)}
      {advanced.length > 0 ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="flex items-center gap-1 rounded-control text-instrument font-medium text-muted transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-120 ease-standard motion-reduce:transition-none",
                advancedOpen && "rotate-90",
              )}
            />
            Advanced
          </button>
          {advancedOpen ? <div className="space-y-4">{advanced.map(renderField)}</div> : null}
        </div>
      ) : null}
    </>
  );
}
