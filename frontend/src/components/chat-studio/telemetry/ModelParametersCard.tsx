"use client";

import { Button } from "@/components/ui/button";
import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";
import { Readout } from "@/components/ui/readout";

import type {
  ModelParameterKey,
  ParameterOverrides,
  ResolvedParameterDefinition,
} from "@/lib/chat-parameters";
import type { ModelInfo } from "@/lib/types";

interface ModelParametersCardProps {
  currentModelInfo: ModelInfo | null;
  visibleParameterDefinitions: ResolvedParameterDefinition[];
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
    return <p className="text-ui text-data-neg">{modelsError}</p>;
  }
  if (modelsLoading && !currentModelInfo) {
    return <p className="text-ui text-muted">Loading model catalog…</p>;
  }
  if (!currentModelInfo) {
    return (
      <p className="text-ui text-muted">
        Unable to find provider metadata for{" "}
        <span className="font-mono text-primary">{selectedModelLabel}</span>.
      </p>
    );
  }
  if (visibleParameterDefinitions.length === 0) {
    return (
      <p className="text-ui text-muted">
        This model does not expose any of the common sampling parameters.
      </p>
    );
  }

  const renderParameterControl = (definition: ResolvedParameterDefinition) => {
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline pb-2">
        <Readout label="Model" className="min-w-0">
          {currentModelInfo.id}
        </Readout>
        <Readout label="Controls">{visibleParameterDefinitions.length}</Readout>
        {activeParameterCount > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={resetAllParameters}>
            Reset overrides
          </Button>
        )}
      </div>
      <div className="space-y-3">
        {visibleParameterDefinitions.map((definition) => renderParameterControl(definition))}
      </div>
    </div>
  );
};
