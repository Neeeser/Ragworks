"use client";

import { useId, useState } from "react";

import { ConnectionConfigFields } from "@/components/connections/ConnectionConfigFields";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { updateConnection, validateConnection } from "@/lib/api";
import { getErrorMessage, getProviderError } from "@/lib/errors";
import { cn } from "@/lib/utils";

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
 * secret fields stay blank and are only sent when re-entered.
 *
 * Test probes the edits without saving them, and a save the provider refuses
 * on reachability becomes "Save anyway" rather than a dead end — a self-hosted
 * server that is down right now is still a connection worth storing.
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
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  // Set only by a save the provider refused on reachability; dropped by any
  // edit or fresh test, so a corrected URL is checked rather than waved past.
  const [unreachable, setUnreachable] = useState(false);

  const fields = providerType?.config_fields ?? [];

  const clearFeedback = () => {
    setError(null);
    setProbeMessage(null);
    setUnreachable(false);
  };

  /**
   * The fields a save would send: secrets only when re-typed, non-secrets only
   * when changed. Test sends the same overlay, so an untouched secret means
   * "use the stored one" in both — testing a moved server URL against a stored
   * key never reports a false rejection.
   */
  const changedConfig = () => {
    const changed: Record<string, string> = {};
    for (const field of fields) {
      const value = (config[field.name] ?? "").trim();
      if (field.kind === "secret") {
        if (value) changed[field.name] = value;
      } else if (value && value !== (connection.config[field.name] ?? "")) {
        changed[field.name] = value;
      }
    }
    return changed;
  };

  const handleTest = async () => {
    setTesting(true);
    clearFeedback();
    try {
      const result = await validateConnection(authToken, connection.id, changedConfig());
      if (result.valid) setProbeMessage(result.message ?? "Connected.");
      else setError(result.message ?? "Validation failed.");
    } catch (testError) {
      setError(getErrorMessage(testError, "Unable to reach the provider."));
    } finally {
      setTesting(false);
    }
  };

  const missingRequired = fields.some((field) => {
    if (!field.required) return false;
    if (field.kind === "secret" && connection.secrets_configured[field.name]) return false;
    return !(config[field.name] ?? "").trim();
  });

  const handleSave = async () => {
    const saveAnyway = unreachable;
    setSaving(true);
    clearFeedback();
    try {
      const changed = changedConfig();
      const updated = await updateConnection(authToken, connection.id, {
        label: label.trim() || connection.label,
        ...(Object.keys(changed).length > 0 ? { config: changed } : {}),
        ...(saveAnyway ? { skip_validation: true } : {}),
      });
      onUpdated(updated);
      onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Unable to save the connection."));
      // Only a reachability refusal is the user's to override.
      setUnreachable(getProviderError(saveError)?.code === "connection");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId}>
      <div className="card-surface flex max-h-[85vh] w-full max-w-xl flex-col bg-canvas-raised shadow-elevation-2">
        <div className="flex items-center gap-3 border-b border-hairline p-3">
          <ProviderIcon
            providerType={connection.provider_type}
            className="h-5 w-5 shrink-0 text-muted"
          />
          <h2
            id={titleId}
            className="min-w-0 truncate text-head font-semibold tracking-[-0.01em] text-primary"
          >
            Edit {connection.label}
          </h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <ProviderKindBadges kinds={connection.kinds} />
          <Field label="Label">
            <TextInput value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <ConnectionConfigFields
            fields={fields}
            config={config}
            onChange={(name, value) => {
              setUnreachable(false);
              setConfig((prev) => ({ ...prev, [name]: value }));
            }}
            secretsConfigured={connection.secrets_configured}
          />
        </div>
        {/* Outside the scrolling body, beside the button that produced it: in a
            long form the result would otherwise land below the fold. */}
        {error || probeMessage ? (
          <p
            className={cn(
              "border-t border-hairline px-3 py-2 text-ui",
              error ? "text-data-neg" : "text-data-pos",
            )}
            role="status"
          >
            {error ?? probeMessage}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 border-t border-hairline p-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleTest}
            loading={testing}
            disabled={missingRequired || saving}
          >
            Test
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            loading={saving}
            disabled={missingRequired || testing}
          >
            {unreachable ? "Save anyway" : "Save changes"}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
