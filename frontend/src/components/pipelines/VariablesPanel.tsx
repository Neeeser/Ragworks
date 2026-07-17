"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { expressionSource } from "@/lib/expressions";
import { cn } from "@/lib/utils";

import { ExpressionInput } from "./ExpressionInput";
import {
  RESERVED_VARIABLE_NAMES,
  VARIABLE_NAME_PATTERN,
  VARIABLE_TYPE_OPTIONS,
  buildStaticEnvironment,
  declaredArguments,
  formatPreviewValue,
} from "./lib/variable-env";

import type { CatalogModel, PipelineVariable, VariableType } from "@/lib/types";

type NodeLike = { type: string; config: Record<string, unknown> };

type VariablesPanelProps = {
  variables: PipelineVariable[];
  onChange: (variables: PipelineVariable[]) => void;
  /** Current canvas nodes — source of declared arguments and reference checks. */
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

function nameProblem(name: string, taken: Set<string>): string | null {
  if (!name) return "Name is required.";
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    return "Lowercase letters, digits, and underscores; start with a letter.";
  }
  if (RESERVED_VARIABLE_NAMES.has(name)) return `'${name}' is reserved.`;
  if (taken.has(name)) return `'${name}' is already declared.`;
  return null;
}

/** Names a variable is referenced by: other variables plus node config expressions. */
function referenceSites(name: string, variables: PipelineVariable[], nodes: NodeLike[]): string[] {
  const sites: string[] = [];
  const pattern = new RegExp(`\\b${name}\\b`);
  for (const variable of variables) {
    if (variable.name !== name && variable.expression && pattern.test(variable.expression)) {
      sites.push(`variable ${variable.name}`);
    }
  }
  for (const node of nodes) {
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
  const argumentsList = useMemo(() => declaredArguments(nodes), [nodes]);
  const env = useMemo(
    () => buildStaticEnvironment(argumentsList, variables),
    [argumentsList, variables],
  );

  const update = (index: number, patch: Partial<PipelineVariable>) => {
    onChange(variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable)));
  };

  const addVariable = () => {
    const base = "variable";
    const taken = new Set([
      ...variables.map((variable) => variable.name),
      ...argumentsList.map((argument) => argument.name),
    ]);
    let name = base;
    let suffix = 1;
    while (taken.has(name)) {
      suffix += 1;
      name = `${base}_${suffix}`;
    }
    onChange([...variables, { name, type: "integer", value: 1 }]);
    setExpanded(name);
  };

  const removeVariable = (index: number) => {
    onChange(variables.filter((_, i) => i !== index));
  };

  return (
    <div className="mt-4 space-y-3">
      {argumentsList.length > 0 ? (
        <div className="space-y-1 rounded-2xl border border-hairline bg-surface p-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Arguments</p>
          <ul className="space-y-0.5">
            {argumentsList.map((argument) => (
              <li key={argument.name} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-body">{argument.name}</span>
                <span className="font-mono text-[11px] text-meta">{argument.type}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-meta">Declared on the retrieval input node.</p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {variables.map((variable, index) => {
          const otherNames = new Set([
            ...variables.filter((_, i) => i !== index).map((entry) => entry.name),
            ...argumentsList.map((argument) => argument.name),
          ]);
          const problem =
            nameProblem(variable.name, otherNames) ?? env.problems.get(variable.name) ?? null;
          const isOpen = expanded === variable.name;
          return (
            <li
              key={index}
              className={cn(
                "rounded-2xl border bg-surface",
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
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-2xl px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-body">
                  {variable.name || "—"}
                </span>
                <span className="font-mono text-[11px] text-meta">
                  {variable.expression != null
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
                <p className="px-3 pb-2 text-xs text-data-neg">{problem}</p>
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
  const isDerived = variable.expression != null;
  const modelValue =
    variable.type === "model" && variable.value && typeof variable.value === "object"
      ? variable.value
      : null;

  const setType = (type: VariableType) => {
    onPatch({
      type,
      value: isDerived ? null : DEFAULT_VALUES[type],
      expression: type === "model" ? null : variable.expression,
      choices: type === "enum" ? (variable.choices ?? []) : undefined,
      minimum: undefined,
      maximum: undefined,
    });
  };

  return (
    <div className="space-y-3 border-t border-hairline px-3 py-3">
      <Field label="Name" error={problem}>
        <TextInput
          value={variable.name}
          onChange={(event) => onPatch({ name: event.target.value })}
          disabled={disabled}
          className="font-mono text-[13px]"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <CustomSelect
            value={variable.type}
            options={VARIABLE_TYPE_OPTIONS}
            placeholder="Type"
            disabled={disabled}
            onValueChange={(value) => setType(value as VariableType)}
          />
        </Field>
        {variable.type !== "model" ? (
          <Field label="Source">
            <CustomSelect
              value={isDerived ? "expression" : "value"}
              options={[
                { value: "value", label: "Value" },
                { value: "expression", label: "Expression" },
              ]}
              placeholder="Source"
              disabled={disabled}
              onValueChange={(mode) =>
                onPatch(
                  mode === "expression"
                    ? { expression: "", value: null }
                    : { expression: null, value: DEFAULT_VALUES[variable.type] },
                )
              }
            />
          </Field>
        ) : null}
      </div>

      {isDerived && variable.type !== "model" ? (
        <ExpressionInput
          aria-label={`Expression for ${variable.name}`}
          value={variable.expression ?? ""}
          onChange={(expression) => onPatch({ expression })}
          env={env}
          expectedType={variable.type === "enum" ? "string" : variable.type}
        />
      ) : variable.type === "model" ? (
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
      ) : (
        <ConstantValueField variable={variable} disabled={disabled} onPatch={onPatch} />
      )}

      {variable.type === "enum" ? (
        <Field label="Choices" hint="Comma-separated.">
          <TextInput
            value={(variable.choices ?? []).join(", ")}
            disabled={disabled}
            onChange={(event) =>
              onPatch({
                choices: event.target.value
                  .split(",")
                  .map((choice) => choice.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        {referencedBy.length > 0 ? (
          <p className="text-xs text-meta">Used by {referencedBy.join(", ")}</p>
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
        <p className="text-xs text-data-neg">
          Deleting breaks the expressions above until they are updated.
        </p>
      ) : null}
    </div>
  );
}

function ConstantValueField({
  variable,
  disabled,
  onPatch,
}: {
  variable: PipelineVariable;
  disabled?: boolean;
  onPatch: (patch: Partial<PipelineVariable>) => void;
}) {
  if (variable.type === "boolean") {
    return (
      <Field label="Value">
        <CustomSelect
          value={variable.value === true ? "true" : "false"}
          options={[
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
          placeholder="Value"
          disabled={disabled}
          onValueChange={(value) => onPatch({ value: value === "true" })}
        />
      </Field>
    );
  }
  if (variable.type === "enum") {
    return (
      <Field label="Value">
        <CustomSelect
          value={typeof variable.value === "string" ? variable.value : ""}
          options={(variable.choices ?? []).map((choice) => ({ value: choice, label: choice }))}
          placeholder="Pick a choice"
          disabled={disabled}
          onValueChange={(value) => onPatch({ value })}
        />
      </Field>
    );
  }
  const numeric = variable.type === "integer" || variable.type === "number";
  return (
    <Field label="Value">
      <TextInput
        type={numeric ? "number" : "text"}
        step={variable.type === "integer" ? 1 : undefined}
        value={variable.value == null ? "" : String(variable.value)}
        disabled={disabled}
        className={numeric ? "font-mono text-[13px]" : undefined}
        onChange={(event) => {
          if (!numeric) {
            onPatch({ value: event.target.value });
            return;
          }
          const raw = event.target.value;
          if (raw === "") {
            onPatch({ value: null });
            return;
          }
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) return;
          onPatch({ value: variable.type === "integer" ? Math.trunc(parsed) : parsed });
        }}
      />
    </Field>
  );
}
