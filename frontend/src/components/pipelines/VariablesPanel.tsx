"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { expressionSource } from "@/lib/expressions";
import { cn } from "@/lib/utils";

import { ExpressionInput } from "./ExpressionInput";
import {
  RESERVED_VARIABLE_NAMES,
  RETRIEVAL_INPUT_TYPE,
  VARIABLE_NAME_PATTERN,
  VARIABLE_TYPE_OPTIONS,
  buildStaticEnvironment,
  formatPreviewValue,
  variableSource,
} from "./lib/variable-env";
import { ConstantValueField, InputVariableFields } from "./VariableValueFields";

import type { ChipTone } from "@/components/ui/chip";
import type { CatalogModel, PipelineVariable, VariableSource, VariableType } from "@/lib/types";

type NodeLike = { type: string; config: Record<string, unknown> };

type VariablesPanelProps = {
  variables: PipelineVariable[];
  onChange: (variables: PipelineVariable[]) => void;
  /** Current canvas nodes — reference checks and input-node acceptance. */
  nodes: NodeLike[];
  modelOptions: CatalogModel[];
  disabled?: boolean;
};

const DEFAULT_VALUES: Record<VariableType, PipelineVariable["value"]> = {
  integer: 1,
  number: 1,
  string: "",
  boolean: false,
  enum: "",
  model: null,
};

const SOURCE_BADGES: Record<VariableSource, string> = {
  value: "Constant",
  expression: "Expression",
  input: "Input",
};

/** Input variables come from the caller — the only source with live state. */
const SOURCE_TONES: Record<VariableSource, ChipTone> = {
  value: "neutral",
  expression: "neutral",
  input: "accent",
};

function nameProblem(name: string, taken: Set<string>): string | null {
  if (!name) return "Name is required.";
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    return "Lowercase letters, digits, and underscores; start with a letter.";
  }
  if (RESERVED_VARIABLE_NAMES.has(name)) return `'${name}' is reserved.`;
  if (taken.has(name)) return `'${name}' is already declared.`;
  return null;
}

/** Names a variable is referenced by: other variables, node config expressions,
 * and the retrieval input node's accepted-arguments list. */
function referenceSites(name: string, variables: PipelineVariable[], nodes: NodeLike[]): string[] {
  const sites: string[] = [];
  const pattern = new RegExp(`\\b${name}\\b`);
  for (const variable of variables) {
    if (variable.name !== name && variable.expression && pattern.test(variable.expression)) {
      sites.push(`variable ${variable.name}`);
    }
  }
  for (const node of nodes) {
    if (
      node.type === RETRIEVAL_INPUT_TYPE &&
      Array.isArray(node.config.arguments) &&
      node.config.arguments.includes(name)
    ) {
      sites.push("the retrieval input node");
    }
    for (const [key, value] of Object.entries(node.config)) {
      const source = expressionSource(value);
      if (source && pattern.test(source)) sites.push(`${node.type} · ${key}`);
    }
  }
  return sites;
}

export function VariablesPanel({
  variables,
  onChange,
  nodes,
  modelOptions,
  disabled,
}: VariablesPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const env = useMemo(() => buildStaticEnvironment(variables), [variables]);

  const update = (index: number, patch: Partial<PipelineVariable>) => {
    onChange(variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable)));
  };

  const addVariable = () => {
    const base = "variable";
    const taken = new Set(variables.map((variable) => variable.name));
    let name = base;
    let suffix = 1;
    while (taken.has(name)) {
      suffix += 1;
      name = `${base}_${suffix}`;
    }
    onChange([...variables, { name, type: "integer", source: "value", value: 1 }]);
    setExpanded(name);
  };

  const removeVariable = (index: number) => {
    onChange(variables.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {variables.map((variable, index) => {
          const otherNames = new Set(
            variables.filter((_, i) => i !== index).map((entry) => entry.name),
          );
          const problem =
            nameProblem(variable.name, otherNames) ?? env.problems.get(variable.name) ?? null;
          const isOpen = expanded === variable.name;
          const source = variableSource(variable);
          return (
            <li
              key={index}
              className={cn(
                "rounded-control border bg-surface",
                problem ? "border-data-neg/50" : "border-hairline",
              )}
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : variable.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpanded(isOpen ? null : variable.name);
                  }
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-control px-2 py-2 transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {/* A variable name is a literal the expression grammar reads. */}
                  <span className="truncate font-mono text-ui text-body">
                    {variable.name || "—"}
                  </span>
                  <Chip tone={SOURCE_TONES[source]} dot={false} className="shrink-0">
                    {SOURCE_BADGES[source]}
                  </Chip>
                </span>
                <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
                  {source === "expression"
                    ? `= ${formatPreviewValue(env.values.get(variable.name))}`
                    : formatPreviewValue(env.values.get(variable.name))}
                </span>
              </div>
              {isOpen ? (
                <VariableEditor
                  variable={variable}
                  problem={problem}
                  env={env}
                  modelOptions={modelOptions}
                  referencedBy={referenceSites(variable.name, variables, nodes)}
                  disabled={disabled}
                  onPatch={(patch) => update(index, patch)}
                  onRemove={() => removeVariable(index)}
                />
              ) : problem ? (
                <p className="px-2 pb-2 text-ui text-data-neg">{problem}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Button type="button" variant="secondary" size="sm" onClick={addVariable} disabled={disabled}>
        Add variable
      </Button>
    </div>
  );
}

type VariableEditorProps = {
  variable: PipelineVariable;
  problem: string | null;
  env: ReturnType<typeof buildStaticEnvironment>;
  modelOptions: CatalogModel[];
  referencedBy: string[];
  disabled?: boolean;
  onPatch: (patch: Partial<PipelineVariable>) => void;
  onRemove: () => void;
};

/** The patch a type switch applies: reset the value, keep what still fits. */
function typePatch(variable: PipelineVariable, type: VariableType): Partial<PipelineVariable> {
  const source = variableSource(variable);
  return {
    type,
    value: source === "expression" || source === "input" ? null : DEFAULT_VALUES[type],
    expression: type === "model" ? null : variable.expression,
    source: type === "model" && source !== "value" ? "value" : variable.source,
    choices: type === "enum" ? (variable.choices ?? []) : undefined,
    minimum: undefined,
    maximum: undefined,
  };
}

/** The patch a source switch applies: swap the value origin, keep the type. */
function sourcePatch(variable: PipelineVariable, next: VariableSource): Partial<PipelineVariable> {
  return {
    source: next,
    expression: next === "expression" ? "" : null,
    value: next === "expression" || next === "input" ? null : DEFAULT_VALUES[variable.type],
    expose_to_llm: next === "input" ? (variable.expose_to_llm ?? false) : undefined,
    minimum: next === "input" ? variable.minimum : undefined,
    maximum: next === "input" ? variable.maximum : undefined,
  };
}

function VariableEditor({
  variable,
  problem,
  env,
  modelOptions,
  referencedBy,
  disabled,
  onPatch,
  onRemove,
}: VariableEditorProps) {
  const source = variableSource(variable);

  return (
    <div className="space-y-3 border-t border-hairline p-2">
      <Field label="Name" error={problem}>
        <TextInput
          value={variable.name}
          onChange={(event) => onPatch({ name: event.target.value })}
          disabled={disabled}
          className="font-mono text-ui"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <CustomSelect
            value={variable.type}
            options={VARIABLE_TYPE_OPTIONS}
            placeholder="Type"
            disabled={disabled}
            onValueChange={(value) => onPatch(typePatch(variable, value as VariableType))}
          />
        </Field>
        {variable.type !== "model" ? (
          <Field label="Source">
            <CustomSelect
              value={source}
              options={[
                { value: "value", label: "Value" },
                { value: "expression", label: "Expression" },
                { value: "input", label: "Input" },
              ]}
              placeholder="Source"
              disabled={disabled}
              onValueChange={(mode) => {
                if (mode !== source) onPatch(sourcePatch(variable, mode as VariableSource));
              }}
            />
          </Field>
        ) : null}
      </div>

      <VariableValueEditor
        variable={variable}
        source={source}
        env={env}
        modelOptions={modelOptions}
        disabled={disabled}
        onPatch={onPatch}
      />

      {variable.type === "enum" && source !== "expression" ? (
        <Field label="Choices" hint="Comma-separated.">
          <TextInput
            value={(variable.choices ?? []).join(", ")}
            disabled={disabled}
            onChange={(event) =>
              onPatch({
                choices: event.target.value
                  .split(",")
                  .map((choice) => choice.trim())
                  .filter(
                    (choice, index, choices) =>
                      Boolean(choice) && choices.indexOf(choice) === index,
                  ),
              })
            }
          />
        </Field>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        {referencedBy.length > 0 ? (
          <p className="min-w-0 text-instrument text-meta">Used by {referencedBy.join(", ")}</p>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Delete variable ${variable.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {referencedBy.length > 0 ? (
        <p className="max-w-[66ch] text-ui text-data-neg">
          Deleting breaks the references above until they are updated.
        </p>
      ) : null}
    </div>
  );
}

/** The value control for one variable, dispatched on its source and type. */
function VariableValueEditor({
  variable,
  source,
  env,
  modelOptions,
  disabled,
  onPatch,
}: {
  variable: PipelineVariable;
  source: VariableSource;
  env: ReturnType<typeof buildStaticEnvironment>;
  modelOptions: CatalogModel[];
  disabled?: boolean;
  onPatch: (patch: Partial<PipelineVariable>) => void;
}) {
  if (source === "input") {
    return <InputVariableFields variable={variable} disabled={disabled} onPatch={onPatch} />;
  }
  if (source === "expression" && variable.type !== "model") {
    return (
      <ExpressionInput
        aria-label={`Expression for ${variable.name}`}
        value={variable.expression ?? ""}
        onChange={(expression) => onPatch({ expression })}
        env={env}
        expectedType={variable.type === "enum" ? "string" : variable.type}
      />
    );
  }
  if (variable.type === "model") {
    const modelValue = variable.value && typeof variable.value === "object" ? variable.value : null;
    return (
      <Field label="Model">
        <CustomSelect
          value={modelValue ? `${modelValue.connection_id}::${modelValue.model_name}` : ""}
          options={modelOptions.map((model) => ({
            value: `${model.connection_id}::${model.id}`,
            label: `${model.name} — ${model.connection_label}`,
          }))}
          placeholder="Pick a model"
          disabled={disabled}
          onValueChange={(encoded) => {
            const [connectionId, ...rest] = encoded.split("::");
            onPatch({ value: { connection_id: connectionId, model_name: rest.join("::") } });
          }}
        />
      </Field>
    );
  }
  return <ConstantValueField variable={variable} disabled={disabled} onPatch={onPatch} />;
}
