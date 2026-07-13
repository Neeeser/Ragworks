"use client";

import { useId, useState } from "react";

import { ConnectionConfigFields } from "@/components/connections/ConnectionConfigFields";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { createConnection, validateConnectionConfig } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { ProviderConnection, ProviderTypeInfo } from "@/lib/types";

interface AddConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  authToken: string;
  providerTypes: ProviderTypeInfo[];
  existingConnections: ProviderConnection[];
  onCreated: (connection: ProviderConnection) => void;
}

/**
 * The generic add-connection flow: pick a provider from the icon grid, then
 * fill a form rendered from that type's `config_fields` catalog. The dialog
 * frame keeps one size across both steps so switching never reflows the
 * overlay; the pre-save probe runs against `/api/connections/validate`.
 */
export function AddConnectionDialog({
  open,
  onClose,
  authToken,
  providerTypes,
  existingConnections,
  onCreated,
}: AddConnectionDialogProps) {
  const titleId = useId();
  const [selectedType, setSelectedType] = useState<ProviderTypeInfo | null>(null);
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);

  const reset = () => {
    setSelectedType(null);
    setLabel("");
    setConfig({});
    setError(null);
    setProbeMessage(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const selectableTypes = providerTypes.filter((type) => {
    if (type.builtin) return false;
    if (type.max_connections_per_user == null) return true;
    const count = existingConnections.filter(
      (connection) => connection.provider_type === type.provider_type,
    ).length;
    return count < type.max_connections_per_user;
  });

  const handlePickType = (type: ProviderTypeInfo) => {
    setSelectedType(type);
    setLabel(type.label);
    setConfig({});
    setError(null);
    setProbeMessage(null);
  };

  const buildConfigPayload = () => {
    const payload: Record<string, string> = {};
    for (const field of selectedType?.config_fields ?? []) {
      const value = (config[field.name] ?? "").trim();
      if (value) {
        payload[field.name] = value;
      }
    }
    return payload;
  };

  const missingRequired = (selectedType?.config_fields ?? []).some(
    (field) => field.required && !(config[field.name] ?? "").trim(),
  );

  const handleProbe = async () => {
    if (!selectedType) return;
    setProbing(true);
    setError(null);
    setProbeMessage(null);
    try {
      const result = await validateConnectionConfig(
        authToken,
        selectedType.provider_type,
        buildConfigPayload(),
      );
      if (result.valid) {
        setProbeMessage(result.message ?? "Connected.");
      } else {
        setError(result.message ?? "Validation failed.");
      }
    } catch (probeError) {
      setError(getErrorMessage(probeError, "Unable to validate the connection."));
    } finally {
      setProbing(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedType) return;
    setSubmitting(true);
    setError(null);
    setProbeMessage(null);
    try {
      const created = await createConnection(authToken, {
        provider_type: selectedType.provider_type,
        label: label.trim() || selectedType.label,
        config: buildConfigPayload(),
      });
      onCreated(created);
      handleClose();
    } catch (createError) {
      setError(getErrorMessage(createError, "Unable to add the connection."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <ModalOverlay open={open} onClose={handleClose} labelledBy={titleId}>
      {/* One fixed frame for both steps so picking a provider never resizes the dialog. */}
      <div className="flex h-[36rem] max-h-[85vh] w-full max-w-xl flex-col rounded-3xl border border-hairline bg-canvas-raised p-6">
        <div className="flex items-center gap-3">
          {selectedType && (
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-hairline bg-surface text-primary">
              <ProviderIcon providerType={selectedType.provider_type} className="h-5 w-5" />
            </span>
          )}
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-primary">
            {selectedType ? `Connect ${selectedType.label}` : "Add a provider"}
          </h2>
        </div>
        {!selectedType ? (
          <div className="mt-5 grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto">
            {selectableTypes.map((type) => (
              <button
                key={type.provider_type}
                type="button"
                onClick={() => handlePickType(type)}
                className="group relative flex flex-col items-center gap-3 rounded-3xl border border-hairline bg-surface px-4 pb-5 pt-7 text-center transition hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {type.recommended && (
                  <span className="absolute right-3 top-3 rounded-full border border-accent-violet/40 bg-accent-violet/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-accent-violet">
                    Recommended
                  </span>
                )}
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-hairline bg-canvas-raised text-primary transition group-hover:text-accent-violet">
                  <ProviderIcon providerType={type.provider_type} className="h-8 w-8" />
                </span>
                <span className="text-sm font-semibold text-primary">{type.label}</span>
                <ProviderKindBadges kinds={type.kinds} />
              </button>
            ))}
            {selectableTypes.length === 0 && (
              <p className="col-span-2 text-sm text-muted">
                Every available provider is already connected.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="mt-5 flex-1 space-y-4 overflow-y-auto pr-1">
              <div className="flex items-center justify-between gap-2">
                <ProviderKindBadges kinds={selectedType.kinds} />
                {selectedType.docs_url && (
                  <a
                    href={selectedType.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent-cyan underline-offset-2 hover:underline"
                  >
                    {selectedType.provider_type === "ollama"
                      ? "Get Ollama"
                      : `Get a ${selectedType.label} API key`}
                  </a>
                )}
              </div>
              <Field label="Label" hint="A name for this connection (e.g. Homelab Ollama).">
                <TextInput value={label} onChange={(event) => setLabel(event.target.value)} />
              </Field>
              <ConnectionConfigFields
                fields={selectedType.config_fields}
                config={config}
                onChange={(name, value) => setConfig((prev) => ({ ...prev, [name]: value }))}
              />
              {error && <p className="text-sm text-data-neg">{error}</p>}
              {probeMessage && <p className="text-sm text-data-pos">{probeMessage}</p>}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-hairline pt-4">
              <Button type="button" variant="ghost" onClick={() => setSelectedType(null)}>
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleProbe}
                  loading={probing}
                  disabled={missingRequired || submitting}
                >
                  Test
                </Button>
                <Button
                  type="button"
                  onClick={handleCreate}
                  loading={submitting}
                  disabled={missingRequired || probing}
                >
                  Add connection
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  );
}
