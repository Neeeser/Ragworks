"use client";

import { useCallback, useMemo, useState } from "react";

import type { ModelParameterKey, ParameterOverrides, ParameterValue } from "@/lib/chat-parameters";
import type { ModelInfo } from "@/lib/types";

interface UseModelParametersParams {
  currentModelInfo: ModelInfo | null;
  modelCatalog: ModelInfo[];
  supportedParameterKeys: Set<ModelParameterKey>;
}

interface UseModelParametersResult {
  parameterOverrides: ParameterOverrides;
  setParameterOverrides: React.Dispatch<React.SetStateAction<ParameterOverrides>>;
  activeParameterCount: number;
  updateParameterValue: (key: ModelParameterKey, value?: ParameterValue | null) => void;
  handleNumberParameterChange: (
    key: ModelParameterKey,
    rawValue: string,
    asInteger?: boolean,
  ) => void;
  handleBooleanParameterChange: (key: ModelParameterKey, checked: boolean) => void;
  handleTextParameterChange: (key: ModelParameterKey, value: string) => void;
  handleSelectParameterChange: (key: ModelParameterKey, value: string) => void;
  handleClearParameter: (key: ModelParameterKey) => void;
  resetAllParameters: () => void;
  formatDefaultParameter: (key: ModelParameterKey) => string | null;
  buildParameterPayload: (
    overrides?: ParameterOverrides,
    modelIdOverride?: string | null,
  ) => Record<string, unknown>;
}

/**
 * Owns per-model parameter overrides and the handlers that mutate them, plus the
 * pure `buildParameterPayload` that filters overrides down to the target model's
 * supported parameters when composing a chat request.
 */
export function useModelParameters({
  currentModelInfo,
  modelCatalog,
  supportedParameterKeys,
}: UseModelParametersParams): UseModelParametersResult {
  const [parameterOverrides, setParameterOverrides] = useState<ParameterOverrides>({});

  const activeParameterCount = useMemo(() => {
    return Object.keys(parameterOverrides).filter((key) =>
      supportedParameterKeys.has(key as ModelParameterKey),
    ).length;
  }, [parameterOverrides, supportedParameterKeys]);

  const updateParameterValue = useCallback(
    (key: ModelParameterKey, value?: ParameterValue | null) => {
      setParameterOverrides((prev) => {
        const next = { ...prev };
        if (value === undefined || value === null) {
          delete next[key];
        } else if (typeof value === "string" && value.trim() === "") {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    },
    [],
  );

  const handleNumberParameterChange = useCallback(
    (key: ModelParameterKey, rawValue: string, asInteger = false) => {
      if (rawValue === "") {
        updateParameterValue(key, undefined);
        return;
      }
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed)) {
        updateParameterValue(key, undefined);
        return;
      }
      updateParameterValue(key, asInteger ? Math.round(parsed) : parsed);
    },
    [updateParameterValue],
  );

  const handleBooleanParameterChange = useCallback(
    (key: ModelParameterKey, checked: boolean) => {
      updateParameterValue(key, checked ? true : undefined);
    },
    [updateParameterValue],
  );

  const handleTextParameterChange = useCallback(
    (key: ModelParameterKey, value: string) => {
      updateParameterValue(key, value);
    },
    [updateParameterValue],
  );

  const handleSelectParameterChange = useCallback(
    (key: ModelParameterKey, value: string) => {
      updateParameterValue(key, value ? value : undefined);
    },
    [updateParameterValue],
  );

  const handleClearParameter = useCallback(
    (key: ModelParameterKey) => {
      updateParameterValue(key, undefined);
    },
    [updateParameterValue],
  );

  const resetAllParameters = useCallback(() => {
    setParameterOverrides({});
  }, []);

  const formatDefaultParameter = useCallback(
    (key: ModelParameterKey) => {
      if (!currentModelInfo?.default_parameters) return null;
      const rawValue = currentModelInfo.default_parameters[key];
      if (rawValue === undefined || rawValue === null) return null;
      if (Array.isArray(rawValue)) {
        return rawValue.join(", ");
      }
      if (typeof rawValue === "object") {
        try {
          return JSON.stringify(rawValue);
        } catch {
          return String(rawValue);
        }
      }
      return String(rawValue);
    },
    [currentModelInfo],
  );

  const buildParameterPayload = useCallback(
    (overrides: ParameterOverrides = parameterOverrides, modelIdOverride?: string | null) => {
      const targetModelId = modelIdOverride ?? currentModelInfo?.id ?? null;
      const modelInfo =
        targetModelId === currentModelInfo?.id
          ? currentModelInfo
          : (modelCatalog.find(
              (model) => model.id === targetModelId || model.canonical_slug === targetModelId,
            ) ?? null);
      if (!modelInfo) {
        return {};
      }
      const supportedSet = new Set(
        (modelInfo.supported_parameters || []).map((param) => param.toLowerCase()),
      );
      const payload: Record<string, unknown> = {};
      Object.entries(overrides).forEach(([key, rawValue]) => {
        const normalizedKey = key.toLowerCase();
        if (!supportedSet.has(normalizedKey)) {
          return;
        }
        if (rawValue === undefined || rawValue === null) {
          return;
        }
        if (normalizedKey === "reasoning") {
          if (typeof rawValue === "string") {
            const trimmedReasoning = rawValue.trim().toLowerCase();
            if (!trimmedReasoning) {
              return;
            }
            payload[normalizedKey] = { effort: trimmedReasoning };
            return;
          }
          if (typeof rawValue === "object") {
            payload[normalizedKey] = rawValue;
          }
          return;
        }
        if (typeof rawValue === "string") {
          const trimmed = rawValue.trim();
          if (!trimmed) {
            return;
          }
          payload[normalizedKey] = trimmed;
          return;
        }
        payload[normalizedKey] = rawValue;
      });
      return payload;
    },
    [currentModelInfo, modelCatalog, parameterOverrides],
  );

  return {
    parameterOverrides,
    setParameterOverrides,
    activeParameterCount,
    updateParameterValue,
    handleNumberParameterChange,
    handleBooleanParameterChange,
    handleTextParameterChange,
    handleSelectParameterChange,
    handleClearParameter,
    resetAllParameters,
    formatDefaultParameter,
    buildParameterPayload,
  };
}
