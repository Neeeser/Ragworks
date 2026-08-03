"use client";

import { allowedTargets, outputFieldsFromConfig } from "./lib/llm";
import { OutputFieldsEditor } from "./OutputFieldsEditor";
import { PromptRefField } from "./PromptRefField";

import type { LlmOutputField, PipelineValidationIssue } from "@/lib/types";

type LlmNodeFieldsProps = {
  nodeType: string;
  config: Record<string, unknown>;
  disabled: boolean;
  validationIssues: PipelineValidationIssue[];
  onConfigChange: (config: Record<string, unknown>) => void;
};

/**
 * The LLM node config surface: the prompt reference and the declarative
 * output-field builder. The node owns its output fields — picking a prompt
 * seeds them from the prompt's version, but a later prompt save never
 * silently restructures the node.
 */
export function LlmNodeFields({
  nodeType,
  config,
  disabled,
  validationIssues,
  onConfigChange,
}: LlmNodeFieldsProps) {
  const fields = outputFieldsFromConfig(config);

  const setFields = (next: LlmOutputField[]) => {
    onConfigChange({
      ...config,
      output_fields: next.map((field) => ({ ...field, target: { ...field.target } })),
    });
  };

  const issueFor = (key: string) =>
    validationIssues.find((issue) => issue.field === key)?.message ?? null;

  return (
    <div className="space-y-3">
      <PromptRefField
        nodeType={nodeType}
        config={config}
        disabled={disabled}
        validationIssues={validationIssues}
        onConfigChange={onConfigChange}
      />
      {(issueFor("prompt") ?? issueFor("system_prompt")) && (
        <p role="alert" className="text-instrument text-data-neg">
          {issueFor("prompt") ?? issueFor("system_prompt")}
        </p>
      )}

      <OutputFieldsEditor
        fields={fields}
        targets={allowedTargets(nodeType)}
        disabled={disabled}
        issue={issueFor("output_fields")}
        onChange={setFields}
      />
    </div>
  );
}
