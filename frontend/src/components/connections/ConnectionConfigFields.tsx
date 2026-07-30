"use client";

import { ChevronRight, Eye, EyeOff, Info } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ProviderConfigField } from "@/lib/types";

/** Config values travel as strings; a boolean field stores its two spellings. */
export const TRUE_VALUE = "true";
const FALSE_VALUE = "false";

export function isFieldEnabled(config: Record<string, string>, field: ProviderConfigField) {
  const stored = config[field.name];
  if (stored === undefined) return field.default === true;
  return stored === TRUE_VALUE;
}

/** The value a field starts from: what the user typed, else its declared default. */
function fieldValue(config: Record<string, string>, field: ProviderConfigField) {
  return config[field.name] ?? (typeof field.default === "string" ? field.default : "");
}

const iconButtonClass =
  "rounded-control p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/**
 * The tooltip trigger for a field's longer explanation.
 *
 * The help text is the button's accessible name rather than a `title`: a
 * `title` cannot be themed and never reaches a keyboard user, and the portaled
 * tooltip box is not adjacent to the trigger in reading order, so naming the
 * button with the text is what gives a screen reader the same explanation the
 * pointer gets on hover.
 */
function FieldHelp({ help }: { help: string }) {
  return (
    <Tooltip content={help}>
      <button type="button" aria-label={help} className={iconButtonClass}>
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

interface FieldProps {
  field: ProviderConfigField;
  config: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

function BooleanConfigField({ field, config, onChange }: FieldProps) {
  return (
    <Checkbox
      checked={isFieldEnabled(config, field)}
      onChange={(checked) => onChange(field.name, checked ? TRUE_VALUE : FALSE_VALUE)}
      label={field.label}
      description={field.description ?? undefined}
    />
  );
}

function SelectConfigField({ field, config, onChange }: FieldProps) {
  return (
    <Field
      label={field.label}
      labelEnd={field.help ? <FieldHelp help={field.help} /> : undefined}
      hint={field.description ?? undefined}
    >
      <CustomSelect
        value={fieldValue(config, field)}
        placeholder="Select…"
        options={field.options.map((option) => ({ value: option.value, label: option.label }))}
        onValueChange={(next) => onChange(field.name, next)}
      />
    </Field>
  );
}

function TextConfigField({
  field,
  config,
  onChange,
  secretConfigured,
}: FieldProps & { secretConfigured?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const isSecret = field.kind === "secret";
  const secretKept = isSecret && secretConfigured;
  const help = field.help ? <FieldHelp help={field.help} /> : null;
  const reveal = isSecret ? (
    <button
      type="button"
      aria-label={`${revealed ? "Hide" : "Show"} secret: ${field.name}`}
      aria-pressed={revealed}
      onClick={() => setRevealed((current) => !current)}
      className={iconButtonClass}
    >
      {revealed ? (
        <EyeOff className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Eye className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  ) : null;
  return (
    <Field
      label={field.label}
      labelEnd={
        help || reveal ? (
          <span className="flex items-center gap-1">
            {help}
            {reveal}
          </span>
        ) : undefined
      }
      hint={
        secretKept
          ? "Configured — leave blank to keep the current value."
          : (field.description ?? (field.required ? undefined : "Optional."))
      }
    >
      <TextInput
        type={isSecret && !revealed ? "password" : "text"}
        placeholder={secretKept ? "••••••••" : (field.placeholder ?? undefined)}
        value={fieldValue(config, field)}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
    </Field>
  );
}

interface ConnectionConfigFieldsProps {
  fields: ProviderConfigField[];
  config: Record<string, string>;
  onChange: (name: string, value: string) => void;
  /** Secret fields already configured on the connection being edited. */
  secretsConfigured?: Record<string, boolean>;
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
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const renderField = (field: ProviderConfigField) => {
    // `key` is passed directly, never spread: React reads it off the element,
    // so a key inside a spread props object is both ignored and warned about.
    const shared = { field, config, onChange };
    if (field.kind === "boolean") return <BooleanConfigField key={field.name} {...shared} />;
    if (field.kind === "select") return <SelectConfigField key={field.name} {...shared} />;
    return (
      <TextConfigField
        key={field.name}
        {...shared}
        secretConfigured={secretsConfigured?.[field.name]}
      />
    );
  };

  const primary = fields.filter((field) => !field.advanced);
  const advanced = fields.filter((field) => field.advanced);

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
