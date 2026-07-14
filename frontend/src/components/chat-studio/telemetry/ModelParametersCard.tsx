"use client";

import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";

import type {
  ModelParameterKey,
  ParameterDefinition,
  ParameterOverrides,
} from "@/lib/chat-parameters";
import type { ModelInfo } from "@/lib/types";

interface ModelParametersCardProps {
  currentModelInfo: ModelInfo | null;
  visibleParameterDefinitions: ParameterDefinition[];
  parameterOverrides: ParameterOverrides;
  activeParameterCount: number;
  resetAllParameters: () => void;
  handleNumberParameterChange: (
    key: ModelParameterKey,
    rawValue: string,
    asInteger?: boolean,
  ) => void;
  handleBooleanParameterChange: (key: ModelParameterKey, checked: boolean) => void;
  handleTextParameterChange: (key: ModelParameterKey, value: string) => void;
  handleSelectParameterChange: (key: ModelParameterKey, value: string) => void;
  handleClearParameter: (key: ModelParameterKey) => void;
  formatDefaultParameter: (key: ModelParameterKey) => string | null;
  modelsError: string | null;
  modelsLoading: boolean;
}

export const ModelParametersCard = ({
  currentModelInfo,
  visibleParameterDefinitions,
  parameterOverrides,
  activeParameterCount,
  resetAllParameters,
  handleNumberParameterChange,
  handleBooleanParameterChange,
  handleTextParameterChange,
  handleSelectParameterChange,
  handleClearParameter,
  formatDefaultParameter,
  modelsError,
  modelsLoading,
}: ModelParametersCardProps) => {
  const selectedModelLabel = currentModelInfo?.id || "the selected model";

  if (modelsError) {
    return <p className="text-sm text-data-neg">{modelsError}</p>;
  }
  if (modelsLoading && !currentModelInfo) {
    return <p className="text-sm text-muted">Loading model catalog…</p>;
  }
  if (!currentModelInfo) {
    return (
      <p className="text-sm text-muted">
        Unable to find provider metadata for{" "}
        <span className="text-primary">{selectedModelLabel}</span>.
      </p>
    );
  }
  if (visibleParameterDefinitions.length === 0) {
    return (
      <p className="text-sm text-muted">
        This model does not expose any of the common sampling parameters.
      </p>
    );
  }

  const renderParameterControl = (definition: ParameterDefinition) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(parameterOverrides, definition.key);
    const currentValue = parameterOverrides[definition.key];
    const defaultDisplay = formatDefaultParameter(definition.key);

    const handleValueChange = (value: string | boolean) => {
      if (definition.input === "number" || definition.input === "integer") {
        handleNumberParameterChange(
          definition.key,
          value as string,
          definition.input === "integer",
        );
      } else if (definition.input === "boolean") {
        handleBooleanParameterChange(definition.key, value === true);
      } else if (definition.input === "select") {
        handleSelectParameterChange(definition.key, value as string);
      } else {
        handleTextParameterChange(definition.key, value as string);
      }
    };

    return (
      <ParameterFieldCard
        key={definition.key}
        label={definition.label}
        description={definition.description}
        helper={defaultDisplay ? `Default: ${defaultDisplay}` : null}
        overrideActive={hasOverride}
        actionLabel="Clear"
        actionDisabled={!hasOverride}
        onAction={() => handleClearParameter(definition.key)}
      >
        <ParameterInput
          input={definition.input}
          value={currentValue}
          min={"min" in definition ? definition.min : undefined}
          max={"max" in definition ? definition.max : undefined}
          step={"step" in definition ? definition.step : undefined}
          placeholder={"placeholder" in definition ? definition.placeholder : undefined}
          options={"options" in definition ? definition.options : undefined}
          rows={"rows" in definition ? definition.rows : undefined}
          onChange={handleValueChange}
        />
      </ParameterFieldCard>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-hairline bg-surface p-3 text-sm text-body">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-meta">Model</p>
        <p className="text-primary">{currentModelInfo.name}</p>
        <p className="text-[11px] text-meta break-all">{currentModelInfo.id}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-meta">
          <span>{visibleParameterDefinitions.length} controls</span>
          {activeParameterCount > 0 && (
            <button
              type="button"
              onClick={resetAllParameters}
              className="text-body underline-offset-4 hover:underline"
            >
              Reset overrides
            </button>
          )}
        </div>
      </div>
      <div className="space-y-4">
        {visibleParameterDefinitions.map((definition) => renderParameterControl(definition))}
      </div>
    </div>
  );
};
