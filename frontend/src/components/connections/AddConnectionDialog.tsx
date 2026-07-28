"use client";

import { useId, useState } from "react";

import {
  ConnectionConfigFields,
  TRUE_VALUE,
} from "@/components/connections/ConnectionConfigFields";
import { toProviderChoices } from "@/components/connections/lib/provider-choices";
import { ProviderChoiceCard } from "@/components/connections/ProviderChoiceCard";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { createConnection, probeCustomServer, validateConnectionConfig } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

import type { ProviderConnection, ProviderTypeInfo, ServerProbeResult } from "@/lib/types";

interface AddConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  authToken: string;
  providerTypes: ProviderTypeInfo[];
  existingConnections: ProviderConnection[];
  onCreated: (connection: ProviderConnection) => void;
}

/** The config a type's fields start from, so declared defaults are visible and sent. */
function seedConfig(type: ProviderTypeInfo): Record<string, string> {
  const seeded: Record<string, string> = {};
  for (const field of type.config_fields) {
    if (typeof field.default === "boolean") {
      seeded[field.name] = field.default ? TRUE_VALUE : "false";
    } else if (typeof field.default === "string") {
      seeded[field.name] = field.default;
    }
  }
  return seeded;
}

/**
 * True when a type is discoverable: it is addressed by URL and declares its
 * capabilities as toggles. Derived from the field catalog rather than a
 * provider-type check, so a future type that works the same way gets the
 * detect step without a change here.
 */
function supportsDetection(type: ProviderTypeInfo): boolean {
  const names = new Set(type.config_fields.map((field) => field.name));
  return names.has("base_url") && type.config_fields.some((field) => field.kind === "boolean");
}

/** The capability toggles a probe writes, keyed by the config field they set. */
const DETECTED_CAPABILITIES: Array<[string, keyof ServerProbeResult]> = [
  ["serves_chat", "serves_chat"],
  ["serves_embeddings", "serves_embeddings"],
  ["serves_reranking", "serves_reranking"],
];

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
  const [detecting, setDetecting] = useState(false);

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

  const providerChoices = toProviderChoices(providerTypes, existingConnections);

  const handlePickType = (type: ProviderTypeInfo) => {
    setSelectedType(type);
    setLabel(type.label);
    setConfig(seedConfig(type));
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

  /**
   * Discover what the server serves and pre-fill the toggles with it.
   *
   * The result is written into the form rather than saved directly: the user
   * is the one who knows their server, so a probe that missed a capability (a
   * slow start-up, a path behind a prefix) is corrected in place instead of
   * being baked into a connection that quietly cannot do the thing.
   */
  const handleDetect = async () => {
    if (!selectedType) return;
    setDetecting(true);
    setError(null);
    setProbeMessage(null);
    try {
      const result = await probeCustomServer(authToken, {
        base_url: (config.base_url ?? "").trim(),
        api_key: (config.api_key ?? "").trim() || null,
      });
      if (!result.reachable) {
        setError(result.message ?? "The server is unreachable.");
        return;
      }
      setConfig((prev) => {
        const next = { ...prev };
        for (const [fieldName, resultKey] of DETECTED_CAPABILITIES) {
          next[fieldName] = result[resultKey] ? TRUE_VALUE : "false";
        }
        if (result.serves_responses && !result.serves_chat) {
          next.chat_dialect = "responses";
        }
        return next;
      });
      const served = DETECTED_CAPABILITIES.filter(([, key]) => result[key]).length;
      setProbeMessage(
        result.message ??
          `Found ${served} of 3 capabilities and ${result.model_ids.length} models.`,
      );
    } catch (detectError) {
      setError(getErrorMessage(detectError, "Unable to reach the server."));
    } finally {
      setDetecting(false);
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
            {providerChoices.map((choice) => (
              <ProviderChoiceCard
                key={choice.type.provider_type}
                choice={choice}
                onPick={() => handlePickType(choice.type)}
              />
            ))}
            {providerChoices.length === 0 ? (
              <div className="col-span-2 p-8 text-center">
                <p className="text-ui text-muted">No provider types are available.</p>
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
                {supportsDetection(selectedType) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleDetect}
                    loading={detecting}
                    disabled={!(config.base_url ?? "").trim() || submitting || probing}
                  >
                    Detect
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleProbe}
                  loading={probing}
                  disabled={missingRequired || submitting || detecting}
                >
                  Test
                </Button>
                <Button
                  type="button"
                  onClick={handleCreate}
                  loading={submitting}
                  disabled={missingRequired || probing || detecting}
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
