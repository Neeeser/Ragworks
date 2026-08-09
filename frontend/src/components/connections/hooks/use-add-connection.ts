"use client";

import { useState } from "react";

import { TRUE_VALUE } from "@/components/connections/ConnectionConfigFields";
import { createConnection, probeCustomServer, validateConnectionConfig } from "@/lib/api";
import { getErrorMessage, getProviderError } from "@/lib/errors";

import type { ProviderConnection, ProviderTypeInfo, ServerProbeResult } from "@/lib/types";

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

/** The capability toggles a probe writes, keyed by the config field they set. */
const DETECTED_CAPABILITIES: Array<[string, keyof ServerProbeResult]> = [
  ["serves_chat", "serves_chat"],
  ["serves_embeddings", "serves_embeddings"],
  ["serves_reranking", "serves_reranking"],
];

interface UseAddConnectionOptions {
  authToken: string;
  onCreated: (connection: ProviderConnection) => void;
  onClose: () => void;
}

/**
 * The add-connection flow's state: which type is selected, its config draft,
 * and the three async actions (test, detect, create) with their shared error
 * and success channels.
 *
 * Every action clears both channels first, so a stale "failed" banner can
 * never sit next to a fresh success message.
 */
export function useAddConnection({ authToken, onCreated, onClose }: UseAddConnectionOptions) {
  const [selectedType, setSelectedType] = useState<ProviderTypeInfo | null>(null);
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  // A save the provider refused on reachability. The next save offers to go
  // through anyway; any edit or fresh test drops it, so a user who fixed the
  // URL after a failure is not silently skipping the check on the config that
  // would now pass.
  const [unreachable, setUnreachable] = useState(false);

  const clearFeedback = () => {
    setError(null);
    setProbeMessage(null);
    setUnreachable(false);
  };

  const close = () => {
    setSelectedType(null);
    setLabel("");
    setConfig({});
    clearFeedback();
    onClose();
  };

  const pickType = (type: ProviderTypeInfo) => {
    setSelectedType(type);
    setLabel(type.label);
    setConfig(seedConfig(type));
    clearFeedback();
  };

  const setField = (name: string, value: string) => {
    setUnreachable(false);
    setConfig((prev) => ({ ...prev, [name]: value }));
  };

  const buildConfigPayload = () => {
    const payload: Record<string, string> = {};
    for (const field of selectedType?.config_fields ?? []) {
      const value = (config[field.name] ?? "").trim();
      if (value) payload[field.name] = value;
    }
    return payload;
  };

  const missingRequired = (selectedType?.config_fields ?? []).some(
    (field) => field.required && !(config[field.name] ?? "").trim(),
  );

  const test = async () => {
    if (!selectedType) return;
    setProbing(true);
    clearFeedback();
    try {
      const result = await validateConnectionConfig(
        authToken,
        selectedType.provider_type,
        buildConfigPayload(),
      );
      if (result.valid) setProbeMessage(result.message ?? "Connected.");
      else setError(result.message ?? "Validation failed.");
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
  const detect = async () => {
    if (!selectedType) return;
    setDetecting(true);
    clearFeedback();
    try {
      const result = await probeCustomServer(authToken, {
        base_url: (config.base_url ?? "").trim(),
        api_key: (config.api_key ?? "").trim() || null,
      });
      if (!result.reachable) {
        setError(result.message ?? "The server is unreachable.");
        return;
      }
      if (result.unauthorized) {
        // Every surface answers 401/403, so the probe learned nothing about
        // what this server serves. Writing that "nothing" into the toggles
        // would clear capabilities the user knows it has, over a problem that
        // is in the key field — so report it as the error it is and leave the
        // form alone.
        setError(result.message ?? "The server rejected the API key.");
        return;
      }
      setConfig((prev) => {
        const next = { ...prev };
        for (const [fieldName, resultKey] of DETECTED_CAPABILITIES) {
          next[fieldName] = result[resultKey] ? TRUE_VALUE : "false";
        }
        if (result.serves_responses && !result.serves_chat) next.chat_dialect = "responses";
        return next;
      });
      const served = DETECTED_CAPABILITIES.filter(([, key]) => result[key]).length;
      setProbeMessage(`Found ${served} of 3 capabilities and ${result.model_ids.length} models.`);
    } catch (detectError) {
      setError(getErrorMessage(detectError, "Unable to reach the server."));
    } finally {
      setDetecting(false);
    }
  };

  const create = async () => {
    if (!selectedType) return;
    const saveAnyway = unreachable;
    setSubmitting(true);
    clearFeedback();
    try {
      const created = await createConnection(authToken, {
        provider_type: selectedType.provider_type,
        label: label.trim() || selectedType.label,
        config: buildConfigPayload(),
        ...(saveAnyway ? { skip_validation: true } : {}),
      });
      onCreated(created);
      close();
    } catch (createError) {
      setError(getErrorMessage(createError, "Unable to add the connection."));
      // Only a reachability refusal is one the user can override; a missing
      // required field or the per-user cap is not.
      setUnreachable(getProviderError(createError)?.code === "connection");
    } finally {
      setSubmitting(false);
    }
  };

  return {
    selectedType,
    label,
    config,
    error,
    probeMessage,
    unreachable,
    busy: { submitting, probing, detecting },
    missingRequired,
    setLabel,
    setField,
    pickType,
    clearType: () => setSelectedType(null),
    close,
    test,
    detect,
    create,
  };
}
