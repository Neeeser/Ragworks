"use client";

import { useId, useState } from "react";

import { ConnectionConfigFields } from "@/components/connections/ConnectionConfigFields";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { createConnection, validateConnectionConfig } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

import type { ProviderConnection, ProviderTypeInfo } from "@/lib/types";

interface AddConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  authToken: string;
  providerTypes: ProviderTypeInfo[];
  existingConnections: ProviderConnection[];
  onCreated: (connection: ProviderConnection) => void;
}

/** Indefinite article for a provider name, by its first sound's spelling. */
const articleFor = (label: string) =>
  "aeiou".includes(label.charAt(0).toLowerCase()) ? "an" : "a";

/** The link text a provider's docs deserve — what the user has to fetch, not "documentation". */
function docsLinkLabel(type: ProviderTypeInfo): string {
  if (type.provider_type === "ollama") return "Get Ollama";
  const needsKey = type.config_fields.some((field) => field.kind === "secret" && field.required);
  return needsKey
    ? `Get ${articleFor(type.label)} ${type.label} API key`
    : "Provider documentation";
}

/**
 * The generic add-connection flow: pick a provider from the mark grid, then
 * fill a form rendered from that type's `config_fields` catalog — a new
 * provider type needs zero new form code here. The dialog frame keeps one size
 * across both steps so switching never reflows the overlay; the pre-save probe
 * runs against `/api/connections/validate`.
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
      <div className="card-surface flex h-[36rem] max-h-[85vh] w-full max-w-xl flex-col bg-canvas-raised shadow-elevation-2">
        <div className="flex items-center gap-3 border-b border-hairline p-3">
          {selectedType ? (
            <ProviderIcon
              providerType={selectedType.provider_type}
              className="h-5 w-5 shrink-0 text-muted"
            />
          ) : null}
          <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
            {selectedType ? `Connect ${selectedType.label}` : "Add a provider"}
          </h2>
        </div>
        {!selectedType ? (
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3">
            {selectableTypes.map((type) => (
              <button
                key={type.provider_type}
                type="button"
                onClick={() => handlePickType(type)}
                className="group relative flex flex-col items-center gap-2 rounded-control border border-hairline bg-surface p-3 text-center transition-colors duration-80 ease-standard hover:border-strong hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {type.recommended ? (
                  <Chip tone="accent" dot={false} className="absolute right-2 top-2">
                    Recommended
                  </Chip>
                ) : null}
                <ProviderIcon
                  providerType={type.provider_type}
                  className="mt-3 h-8 w-8 text-muted transition-colors duration-80 ease-standard group-hover:text-accent-violet"
                />
                <span className="text-ui font-medium text-primary">{type.label}</span>
                <ProviderKindBadges kinds={type.kinds} />
              </button>
            ))}
            {selectableTypes.length === 0 ? (
              <div className="col-span-2 p-8 text-center">
                <p className="text-ui text-muted">Every available provider is already connected.</p>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ProviderKindBadges kinds={selectedType.kinds} />
                {selectedType.docs_url ? (
                  <a
                    href={selectedType.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-control text-instrument text-accent-cyan underline-offset-2 transition-colors duration-80 ease-standard hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  >
                    {docsLinkLabel(selectedType)}
                  </a>
                ) : null}
              </div>
              <Field label="Label" hint="A name for this connection (e.g. Homelab Ollama).">
                <TextInput value={label} onChange={(event) => setLabel(event.target.value)} />
              </Field>
              <ConnectionConfigFields
                fields={selectedType.config_fields}
                config={config}
                onChange={(name, value) => setConfig((prev) => ({ ...prev, [name]: value }))}
              />
            </div>
            {/* The probe result sits outside the scrolling body, next to the
                Test button that produced it: at the bottom of a long form it
                landed below the fold, so a connection read as having done
                nothing until the user scrolled. Test and Add both clear both
                channels first, so only one is ever set. */}
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
            <div className="flex items-center justify-between gap-2 border-t border-hairline p-3">
              <Button type="button" variant="ghost" onClick={() => setSelectedType(null)}>
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
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
