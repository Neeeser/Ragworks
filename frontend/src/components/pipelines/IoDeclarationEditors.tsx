"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";

import { ExpressionInput } from "./ExpressionInput";
import { RESERVED_VARIABLE_NAMES, VARIABLE_NAME_PATTERN, inputVariables } from "./lib/variable-env";

import type { StaticEnvironment } from "./lib/variable-env";
import type { PipelineOutputField, PipelineVariable } from "@/lib/types";

/** Read the accepted input-variable names out of a raw node config. */
export function acceptedNamesFromConfig(config: Record<string, unknown>): string[] {
  const raw = config.arguments;
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Read the declared outputs list out of a raw node config. */
export function outputsFromConfig(config: Record<string, unknown>): PipelineOutputField[] {
  const raw = config.outputs;
  return Array.isArray(raw) ? (raw as PipelineOutputField[]) : [];
}

const sectionLabel = "font-mono text-[10px] uppercase tracking-[0.28em] text-muted";

function argumentNameProblem(name: string, taken: Set<string>): string | null {
  if (!name) return "Name is required.";
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    return "Lowercase letters, digits, and underscores; start with a letter.";
  }
  if (RESERVED_VARIABLE_NAMES.has(name)) return `'${name}' is reserved.`;
  if (taken.has(name)) return `'${name}' is already declared.`;
  return null;
}

type ArgumentsPickerProps = {
  acceptedNames: string[];
  onChange: (names: string[]) => void;
  /** The definition's variables — input-source ones are the pickable set. */
  variables: PipelineVariable[];
  disabled: boolean;
};

/**
 * Picks which input variables this pipeline accepts from callers. The
 * variables themselves (type, default, bounds, exposure) are defined on the
 * Variables tab; this node only selects from them. `query` is built in.
 */
export function ArgumentsPicker({
  acceptedNames,
  onChange,
  variables,
  disabled,
}: ArgumentsPickerProps) {
  const inputs = inputVariables(variables);
  const inputNames = new Set(inputs.map((variable) => variable.name));
  const stale = acceptedNames.filter((name) => !inputNames.has(name));

  const toggle = (name: string, accepted: boolean) => {
    if (accepted) {
      if (!acceptedNames.includes(name)) onChange([...acceptedNames, name]);
    } else {
      onChange(acceptedNames.filter((entry) => entry !== name));
    }
  };

  return (
    <div className="space-y-3">
      <p className={sectionLabel}>Arguments</p>
      <p className="text-xs text-body">
        Which input variables callers can supply per query. Define them (type, default, bounds,
        model exposure) on the Variables tab. `query` is built in.
      </p>
      {inputs.length === 0 ? (
        <p className="rounded-2xl border border-hairline bg-surface px-3 py-2 text-xs text-body">
          No input variables declared — add one on the Variables tab with source “Input”.
        </p>
      ) : (
        <ul className="space-y-1">
          {inputs.map((variable) => (
            <li key={variable.name}>
              <label className="flex items-center justify-between gap-2 rounded-2xl border border-hairline bg-surface px-3 py-2 text-xs text-body">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={acceptedNames.includes(variable.name)}
                    disabled={disabled}
                    onChange={(event) => toggle(variable.name, event.target.checked)}
                  />
                  <span className="font-mono text-[13px]">{variable.name}</span>
                </span>
                <span className="font-mono text-[11px] text-meta">
                  {variable.type}
                  {variable.value == null ? " · required" : ` · ${String(variable.value)}`}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {stale.map((name) => (
        <div
          key={name}
          className="flex items-center justify-between gap-2 rounded-2xl border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-xs text-data-neg"
        >
          <span>
            <span className="font-mono">{name}</span> is not a declared input variable.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Remove accepted argument ${name}`}
            onClick={() => toggle(name, false)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

type OutputsEditorProps = {
  outputs: PipelineOutputField[];
  onChange: (outputs: PipelineOutputField[]) => void;
  env: StaticEnvironment;
  disabled: boolean;
};

/**
 * Declares extra named outputs on `retrieval.output`: expressions evaluated
 * at run end and returned beside the results.
 */
export function OutputsEditor({ outputs, onChange, env, disabled }: OutputsEditorProps) {
  const update = (index: number, patch: Partial<PipelineOutputField>) => {
    onChange(outputs.map((output, i) => (i === index ? { ...output, ...patch } : output)));
  };

  return (
    <div className="space-y-3">
      <p className={sectionLabel}>Outputs</p>
      <p className="text-xs text-body">
        Evaluated when the run finishes and returned beside the results.
      </p>
      {outputs.map((output, index) => {
        const taken = new Set(outputs.filter((_, i) => i !== index).map((entry) => entry.name));
        const problem = argumentNameProblem(output.name, taken);
        return (
          <div key={index} className="space-y-3 rounded-2xl border border-hairline bg-surface p-3">
            <div className="flex items-end gap-2">
              <Field label="Name" error={problem} className="flex-1">
                <TextInput
                  value={output.name}
                  disabled={disabled}
                  className="font-mono text-[13px]"
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`Delete output ${output.name}`}
                onClick={() => onChange(outputs.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <ExpressionInput
              aria-label={`Expression for output ${output.name}`}
              value={output.expression}
              onChange={(expression) => update(index, { expression })}
              env={env}
            />
          </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() =>
          onChange([...outputs, { name: `output_${outputs.length + 1}`, expression: "" }])
        }
      >
        Add output
      </Button>
    </div>
  );
}
