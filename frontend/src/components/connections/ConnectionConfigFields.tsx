"use client";

import { Field, TextInput } from "@/components/ui/field";

import type { ProviderConfigField } from "@/lib/types";

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
 */
export function ConnectionConfigFields({
  fields,
  config,
  onChange,
  secretsConfigured,
}: ConnectionConfigFieldsProps) {
  return (
    <>
      {fields.map((field) => {
        const secretKept = field.kind === "secret" && secretsConfigured?.[field.name];
        return (
          <Field
            key={field.name}
            label={field.label}
            hint={
              secretKept
                ? "Configured — leave blank to keep the current value."
                : (field.description ?? (field.required ? undefined : "Optional."))
            }
          >
            <TextInput
              type={field.kind === "secret" ? "password" : "text"}
              placeholder={secretKept ? "••••••••" : (field.placeholder ?? undefined)}
              value={config[field.name] ?? ""}
              onChange={(event) => onChange(field.name, event.target.value)}
            />
          </Field>
        );
      })}
    </>
  );
}
