"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";

import { ExpressionInput } from "./ExpressionInput";
import {
  RESERVED_VARIABLE_NAMES,
  VARIABLE_NAME_PATTERN,
  VARIABLE_TYPE_OPTIONS,
} from "./lib/variable-env";

import type { StaticEnvironment } from "./lib/variable-env";
import type { PipelineInputArgument, PipelineOutputField, VariableType } from "@/lib/types";

/** Read the declared arguments list out of a raw node config. */
export function argumentsFromConfig(config: Record<string, unknown>): PipelineInputArgument[] {
  const raw = config.arguments;
  return Array.isArray(raw) ? (raw as PipelineInputArgument[]) : [];
}

/** Read the declared outputs list out of a raw node config. */
export function outputsFromConfig(config: Record<string, unknown>): PipelineOutputField[] {
  const raw = config.outputs;
  return Array.isArray(raw) ? (raw as PipelineOutputField[]) : [];
}

const ARGUMENT_TYPE_OPTIONS = VARIABLE_TYPE_OPTIONS.filter((option) => option.value !== "model");

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

type ArgumentsEditorProps = {
  argumentsList: PipelineInputArgument[];
  onChange: (argumentsList: PipelineInputArgument[]) => void;
  /** Names already taken elsewhere (pipeline variables). */
  reservedNames: Set<string>;
  disabled: boolean;
};

/**
 * Declares the caller-supplied inputs on `retrieval.input`: what the search
 * page renders controls for and what the chat tool schema publishes.
 */
export function ArgumentsEditor({
  argumentsList,
  onChange,
  reservedNames,
  disabled,
}: ArgumentsEditorProps) {
  const update = (index: number, patch: Partial<PipelineInputArgument>) => {
    onChange(
      argumentsList.map((argument, i) => (i === index ? { ...argument, ...patch } : argument)),
    );
  };

  const addArgument = () => {
    const taken = new Set([...argumentsList.map((argument) => argument.name), ...reservedNames]);
    let name = "top_k";
    let suffix = 1;
    while (taken.has(name)) {
      suffix += 1;
      name = `argument_${suffix}`;
    }
    onChange([
      ...argumentsList,
      name === "top_k"
        ? {
            name,
            type: "integer",
            description: "How many chunks to retrieve.",
            default: 5,
            minimum: 1,
            maximum: 10,
            expose_to_llm: true,
          }
        : { name, type: "integer", default: 1, expose_to_llm: false },
    ]);
  };

  return (
    <div className="space-y-3">
      <p className={sectionLabel}>Arguments</p>
      <p className="text-xs text-body">
        Callers supply these per query — the search page renders a control per argument, and the
        ones exposed to the model become the collection tool&apos;s parameters. `query` is built in.
      </p>
      {argumentsList.map((argument, index) => {
        const others = new Set([
          ...argumentsList.filter((_, i) => i !== index).map((entry) => entry.name),
          ...reservedNames,
        ]);
        const problem = argumentNameProblem(argument.name, others);
        const numeric = argument.type === "integer" || argument.type === "number";
        return (
          <div key={index} className="space-y-3 rounded-2xl border border-hairline bg-surface p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" error={problem}>
                <TextInput
                  value={argument.name}
                  disabled={disabled}
                  className="font-mono text-[13px]"
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </Field>
              <Field label="Type">
                <CustomSelect
                  value={argument.type}
                  options={ARGUMENT_TYPE_OPTIONS}
                  placeholder="Type"
                  disabled={disabled}
                  onValueChange={(value) =>
                    update(index, {
                      type: value as VariableType,
                      default: null,
                      minimum: null,
                      maximum: null,
                      choices: value === "enum" ? (argument.choices ?? []) : undefined,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Description" hint="Shown to callers — the model reads it too.">
              <TextInput
                value={argument.description ?? ""}
                disabled={disabled}
                onChange={(event) => update(index, { description: event.target.value })}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Default">
                <ArgumentDefaultInput
                  argument={argument}
                  disabled={disabled}
                  onPatch={(patch) => update(index, patch)}
                />
              </Field>
              {numeric ? (
                <>
                  <Field label="Min">
                    <NumberOrEmptyInput
                      value={argument.minimum ?? null}
                      disabled={disabled}
                      onChange={(minimum) => update(index, { minimum })}
                    />
                  </Field>
                  <Field label="Max">
                    <NumberOrEmptyInput
                      value={argument.maximum ?? null}
                      disabled={disabled}
                      onChange={(maximum) => update(index, { maximum })}
                    />
                  </Field>
                </>
              ) : null}
            </div>
            {argument.type === "enum" ? (
              <Field label="Choices" hint="Comma-separated.">
                <TextInput
                  value={(argument.choices ?? []).join(", ")}
                  disabled={disabled}
                  onChange={(event) =>
                    update(index, {
                      choices: event.target.value
                        .split(",")
                        .map((choice) => choice.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-body">
                  <input
                    type="checkbox"
                    checked={argument.required ?? false}
                    disabled={disabled}
                    onChange={(event) => update(index, { required: event.target.checked })}
                  />
                  Required
                </label>
                <label className="flex items-center gap-2 text-xs text-body">
                  <input
                    type="checkbox"
                    checked={argument.expose_to_llm ?? false}
                    disabled={disabled}
                    onChange={(event) => update(index, { expose_to_llm: event.target.checked })}
                  />
                  Expose to model
                </label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`Delete argument ${argument.name}`}
                onClick={() => onChange(argumentsList.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {!argument.required && argument.default == null ? (
              <p className="text-xs text-data-neg">Optional arguments need a default.</p>
            ) : null}
          </div>
        );
      })}
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={addArgument}>
        Add argument
      </Button>
    </div>
  );
}

function ArgumentDefaultInput({
  argument,
  disabled,
  onPatch,
}: {
  argument: PipelineInputArgument;
  disabled: boolean;
  onPatch: (patch: Partial<PipelineInputArgument>) => void;
}) {
  if (argument.type === "boolean") {
    return (
      <CustomSelect
        value={argument.default === true ? "true" : argument.default === false ? "false" : ""}
        options={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        placeholder="—"
        disabled={disabled}
        onValueChange={(value) => onPatch({ default: value === "true" })}
      />
    );
  }
  if (argument.type === "enum") {
    return (
      <CustomSelect
        value={typeof argument.default === "string" ? argument.default : ""}
        options={(argument.choices ?? []).map((choice) => ({ value: choice, label: choice }))}
        placeholder="—"
        disabled={disabled}
        onValueChange={(value) => onPatch({ default: value })}
      />
    );
  }
  if (argument.type === "string") {
    return (
      <TextInput
        value={typeof argument.default === "string" ? argument.default : ""}
        disabled={disabled}
        onChange={(event) => onPatch({ default: event.target.value })}
      />
    );
  }
  return (
    <NumberOrEmptyInput
      value={typeof argument.default === "number" ? argument.default : null}
      disabled={disabled}
      onChange={(value) =>
        onPatch({
          default: value == null ? null : argument.type === "integer" ? Math.trunc(value) : value,
        })
      }
    />
  );
}

function NumberOrEmptyInput({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <TextInput
      type="number"
      value={value == null ? "" : String(value)}
      disabled={disabled}
      className="font-mono text-[13px]"
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
    />
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
