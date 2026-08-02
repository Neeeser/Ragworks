"use client";

import { Plus, X } from "lucide-react";

import { CustomSelect } from "@/components/ui/custom-select";
import { TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import { allowedTargets, emptyOutputField, outputFieldsFromConfig } from "./lib/llm";
import { PromptRefField } from "./PromptRefField";

import type { LlmOutputField, LlmOutputTarget, PipelineValidationIssue } from "@/lib/types";

type LlmNodeFieldsProps = {
  nodeType: string;
  config: Record<string, unknown>;
  disabled: boolean;
  validationIssues: PipelineValidationIssue[];
  onConfigChange: (config: Record<string, unknown>) => void;
};

const TYPE_OPTIONS = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "string_list", label: "Text list" },
];

const TARGET_LABELS: Record<LlmOutputTarget["kind"], string> = {
  metadata: "Metadata key",
  text: "Item text",
  score: "Score",
  items: "New items",
};

const defaultTarget = (kind: LlmOutputTarget["kind"]): LlmOutputTarget => {
  if (kind === "metadata") return { kind: "metadata", key: "" };
  if (kind === "text") return { kind: "text", mode: "replace", separator: "\n\n" };
  if (kind === "score") return { kind: "score" };
  return { kind: "items" };
};

/**
 * The LLM node config surface: the prompt templates and the declarative
 * output-field builder. Each field names one property of the structured
 * output the model must return, and where the engine writes it.
 */
export function LlmNodeFields({
  nodeType,
  config,
  disabled,
  validationIssues,
  onConfigChange,
}: LlmNodeFieldsProps) {
  const fields = outputFieldsFromConfig(config);
  const targets = allowedTargets(nodeType);

  const setValue = (key: string, value: unknown) => {
    onConfigChange({ ...config, [key]: value });
  };

  const setFields = (next: LlmOutputField[]) => {
    setValue(
      "output_fields",
      next.map((field) => ({ ...field, target: { ...field.target } })),
    );
  };

  const updateField = (index: number, patch: Partial<LlmOutputField>) => {
    setFields(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
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

      <div>
        <div className="flex items-center justify-between">
          <InstrumentLabel>Output fields</InstrumentLabel>
          {!disabled ? (
            <button
              type="button"
              onClick={() => setFields([...fields, emptyOutputField(nodeType)])}
              className="flex items-center gap-1 rounded-control px-1.5 py-0.5 text-instrument text-accent-cyan transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <Plus className="h-3 w-3" aria-hidden />
              Add field
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-instrument text-meta">
          The structured output the model must return, and where each field is written.
        </p>
        {issueFor("output_fields") ? (
          <p role="alert" className="mt-1 text-instrument text-data-neg">
            {issueFor("output_fields")}
          </p>
        ) : null}
        <div className="mt-2 space-y-2">
          {fields.map((field, index) => (
            <div
              key={index}
              className="space-y-2 rounded-control border border-hairline bg-surface p-2"
            >
              <div className="flex items-center gap-2">
                <TextInput
                  aria-label={`Field ${index + 1} name`}
                  placeholder="field_name"
                  value={field.name}
                  disabled={disabled}
                  className="min-w-0 flex-1 font-mono text-ui"
                  onChange={(event) => updateField(index, { name: event.target.value })}
                />
                <CustomSelect
                  aria-label={`Field ${index + 1} type`}
                  placeholder="Type"
                  value={field.type}
                  disabled={disabled || field.target.kind === "items"}
                  options={TYPE_OPTIONS}
                  onValueChange={(value) =>
                    updateField(index, { type: value as LlmOutputField["type"] })
                  }
                  className="w-28 shrink-0"
                />
                {!disabled ? (
                  <button
                    type="button"
                    aria-label={`Remove field ${index + 1}`}
                    onClick={() => setFields(fields.filter((_, i) => i !== index))}
                    className="shrink-0 rounded-control p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
              <TextInput
                aria-label={`Field ${index + 1} description`}
                placeholder="What the model should put here"
                value={field.description}
                disabled={disabled}
                onChange={(event) => updateField(index, { description: event.target.value })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <CustomSelect
                  aria-label={`Field ${index + 1} write target`}
                  placeholder="Target"
                  value={field.target.kind}
                  disabled={disabled || targets.length === 1}
                  options={targets.map((kind) => ({ value: kind, label: TARGET_LABELS[kind] }))}
                  onValueChange={(value) => {
                    const kind = value as LlmOutputTarget["kind"];
                    updateField(index, {
                      target: defaultTarget(kind),
                      ...(kind === "score" ? { type: "number" } : {}),
                      ...(kind === "items" ? { type: "string_list" } : {}),
                    });
                  }}
                  className="w-36 shrink-0"
                />
                {field.target.kind === "metadata" ? (
                  <TextInput
                    aria-label={`Field ${index + 1} metadata key`}
                    placeholder="metadata key"
                    value={field.target.key}
                    disabled={disabled}
                    className="min-w-0 flex-1 font-mono text-ui"
                    onChange={(event) =>
                      updateField(index, {
                        target: { kind: "metadata", key: event.target.value },
                      })
                    }
                  />
                ) : null}
                {field.target.kind === "text" ? (
                  <CustomSelect
                    aria-label={`Field ${index + 1} text mode`}
                    placeholder="Mode"
                    value={field.target.mode}
                    disabled={disabled}
                    options={[
                      { value: "prepend", label: "Prepend" },
                      { value: "append", label: "Append" },
                      { value: "replace", label: "Replace" },
                    ]}
                    onValueChange={(value) =>
                      updateField(index, {
                        target: {
                          kind: "text",
                          mode: value as "replace" | "prepend" | "append",
                          separator: field.target.kind === "text" ? field.target.separator : "\n\n",
                        },
                      })
                    }
                    className="w-28 shrink-0"
                  />
                ) : null}
              </div>
            </div>
          ))}
          {fields.length === 0 ? (
            <p className="rounded-control border border-dashed border-hairline p-3 text-center text-instrument text-muted">
              No output fields yet — the model needs at least one.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
