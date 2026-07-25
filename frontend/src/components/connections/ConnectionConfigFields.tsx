"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

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
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  return (
    <>
      {fields.map((field) => {
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
              value={config[field.name] ?? ""}
              onChange={(event) => onChange(field.name, event.target.value)}
            />
          </Field>
        );
      })}
    </>
  );
}
