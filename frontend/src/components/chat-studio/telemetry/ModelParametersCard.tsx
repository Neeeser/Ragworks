"use client";

import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";

import type {
  ModelParameterKey,
  ParameterDefinition,
  ParameterOverrides,
} from "@/lib/chat-parameters";
import type { Collection, ModelInfo } from "@/lib/types";

interface ModelParametersCardProps {
  collection: Collection | null;
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
  collection,
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
    return <p className="text-sm text-rose-300">{modelsError}</p>;
  }
  if (modelsLoading && !currentModelInfo) {
    return <p className="text-sm text-slate-400">Loading model catalog…</p>;
  }
  if (!collection) {
    return <p className="text-sm text-slate-400">Select a collection to view model controls.</p>;
  }
  if (!currentModelInfo) {
    return (
      <p className="text-sm text-slate-400">
        Unable to find OpenRouter metadata for{" "}
        <span className="text-white">{selectedModelLabel}</span>.
      </p>
    );
  }
  if (visibleParameterDefinitions.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        This model does not expose the common sampling parameters listed in the OpenRouter docs.
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
        actionLabel="Clear"
        actionDisabled={!hasOverride}
        onAction={() => handleClearParameter(definition.key)}
      >
        <ParameterInput
          input={definition.input}
          value={currentValue}
          min={definition.min}
          max={definition.max}
          step={definition.step}
          placeholder={definition.placeholder}
          options={definition.options}
          rows={definition.rows}
          onChange={handleValueChange}
        />
      </ParameterFieldCard>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
        <p className="text-[11px] uppercase tracking-[0.35em] text-slate-500">Model</p>
        <p className="text-white">{currentModelInfo.name}</p>
        <p className="text-[11px] text-slate-500 break-all">{currentModelInfo.id}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-500">
          <span>{visibleParameterDefinitions.length} controls</span>
          {activeParameterCount > 0 && (
            <button
              type="button"
              onClick={resetAllParameters}
              className="text-slate-200 underline-offset-4 hover:underline"
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
