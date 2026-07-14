"use client";

import { useId, useState } from "react";

import { ConnectionConfigFields } from "@/components/connections/ConnectionConfigFields";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { updateConnection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { ProviderConnection, ProviderTypeInfo } from "@/lib/types";

interface EditConnectionDialogProps {
  connection: ProviderConnection;
  providerType: ProviderTypeInfo | undefined;
  authToken: string;
  onClose: () => void;
  onUpdated: (connection: ProviderConnection) => void;
}

/**
 * Edit a saved connection: relabel it or rotate config values (a new API key,
 * a moved Ollama server). Non-secret fields prefill from the redacted config;
 * secret fields stay blank and are only sent when re-entered — the backend
 * overlays changed fields and re-validates the connection live before saving.
 */
export function EditConnectionDialog({
  connection,
  providerType,
  authToken,
  onClose,
  onUpdated,
}: EditConnectionDialogProps) {
  const titleId = useId();
  const [label, setLabel] = useState(connection.label);
  const [config, setConfig] = useState<Record<string, string>>(() => ({ ...connection.config }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = providerType?.config_fields ?? [];

  const missingRequired = fields.some((field) => {
    if (!field.required) return false;
    if (field.kind === "secret" && connection.secrets_configured[field.name]) return false;
    return !(config[field.name] ?? "").trim();
  });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const changed: Record<string, string> = {};
      for (const field of fields) {
        const value = (config[field.name] ?? "").trim();
        if (field.kind === "secret") {
          if (value) changed[field.name] = value;
        } else if (value && value !== (connection.config[field.name] ?? "")) {
          changed[field.name] = value;
        }
      }
      const updated = await updateConnection(authToken, connection.id, {
        label: label.trim() || connection.label,
        ...(Object.keys(changed).length > 0 ? { config: changed } : {}),
      });
      onUpdated(updated);
      onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Unable to save the connection."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId}>
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-3xl border border-hairline bg-canvas-raised p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-hairline bg-surface text-primary">
            <ProviderIcon providerType={connection.provider_type} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-primary">
              Edit {connection.label}
            </h2>
          </div>
        </div>
        <div className="mt-5 flex-1 space-y-4 overflow-y-auto pr-1">
          <ProviderKindBadges kinds={connection.kinds} />
          <Field label="Label">
            <TextInput value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <ConnectionConfigFields
            fields={fields}
            config={config}
            onChange={(name, value) => setConfig((prev) => ({ ...prev, [name]: value }))}
            secretsConfigured={connection.secrets_configured}
          />
          {error && <p className="text-sm text-data-neg">{error}</p>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-hairline pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} loading={saving} disabled={missingRequired}>
            Save changes
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
