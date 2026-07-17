"use client";

import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";
import { expressionSource } from "@/lib/expressions";

import { ExpressionInput } from "./ExpressionInput";
import { formatConfigValue, getInputValue } from "./lib/pipeline-config";

import type { PipelineConfigField } from "./lib/pipeline-config";
import type { StaticEnvironment } from "./lib/variable-env";
import type { PipelineValidationIssue } from "@/lib/types";

type ConfigFieldRowProps = {
  field: PipelineConfigField;
  nodeId: string;
  config: Record<string, unknown>;
  env: StaticEnvironment;
  disabled: boolean;
  issue?: PipelineValidationIssue;
  /** Set (or clear with `undefined`) one config key. */
  onValueChange: (key: string, value: unknown | undefined) => void;
  onLiteralChange: (field: PipelineConfigField, raw: string | boolean) => void;
};

/**
 * One schema-driven config field, switchable between its typed literal
 * control and expression mode (`{"$expr": ...}` on the wire). The ƒx toggle
 * appears on every scalar field; identity fields keep it but enforce the
 * static-only rule live.
 */
export function ConfigFieldRow({
  field,
  nodeId,
  config,
  env,
  disabled,
  issue,
  onValueChange,
  onLiteralChange,
}: ConfigFieldRowProps) {
  const rawValue = config[field.key];
  const source = expressionSource(rawValue);
  const isExpression = source !== null;
  const inputId = `node-${nodeId}-${field.key}`;
  const issueId = issue ? `${inputId}-validation` : undefined;
  const helper = isExpression
    ? field.staticOnly
      ? "Constants only — this field identifies infrastructure."
      : undefined
    : field.defaultValue !== undefined
      ? `Default: ${formatConfigValue(field.defaultValue)}`
      : field.required
        ? "Required"
        : undefined;

  const canToggle = field.exprType !== null && !disabled;

  return (
    <ParameterFieldCard
      label={field.label}
      description={field.description}
      helper={helper}
      error={issue?.message}
      errorId={issueId}
      controlId={inputId}
      actionLabel={canToggle ? (isExpression ? "literal" : "ƒx") : undefined}
      onAction={
        canToggle
          ? () => onValueChange(field.key, isExpression ? undefined : { $expr: "" })
          : undefined
      }
    >
      {isExpression ? (
        <ExpressionInput
          id={inputId}
          aria-label={`${field.label} expression`}
          value={source}
          onChange={(next) => onValueChange(field.key, { $expr: next })}
          env={env}
          expectedType={field.exprType}
          staticOnly={field.staticOnly}
        />
      ) : (
        <ParameterInput
          id={inputId}
          ariaInvalid={issue?.severity === "error"}
          ariaDescribedBy={issueId}
          input={field.input}
          value={getInputValue(field, config)}
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={field.placeholder}
          options={field.options}
          disabled={disabled}
          onChange={(nextValue) => onLiteralChange(field, nextValue)}
        />
      )}
    </ParameterFieldCard>
  );
}
