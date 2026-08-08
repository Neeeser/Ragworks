"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CheckboxBox } from "@/components/ui/checkbox";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import { ExpressionInput } from "./ExpressionInput";
import { createId } from "./lib/pipeline-utils";
import {
  RESERVED_VARIABLE_NAMES,
  VARIABLE_NAME_PATTERN,
  inputVariables,
  withItemScope,
} from "./lib/variable-env";

import type { StaticEnvironment } from "./lib/variable-env";
import type { PipelineOutputField, PipelineRouterBranch, PipelineVariable } from "@/lib/types";

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

/** Read the router's branch list out of a raw node config. */
export function branchesFromConfig(config: Record<string, unknown>): PipelineRouterBranch[] {
  const raw = config.branches;
  return Array.isArray(raw) ? (raw as PipelineRouterBranch[]) : [];
}

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
    <div className="space-y-2">
      <InstrumentLabel className="text-body">Arguments</InstrumentLabel>
      <p className="max-w-[66ch] text-ui text-muted">
        Which input variables callers can supply per query. Define them (type, default, bounds,
        model exposure) on the Variables tab. <code className="font-mono">query</code> is built in.
      </p>
      {inputs.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">
          No input variables declared — add one on the Variables tab with source “Input”.
        </p>
      ) : (
        <ul className="space-y-1">
          {inputs.map((variable) => (
            <li key={variable.name}>
              <label className="flex items-center justify-between gap-2 rounded-control border border-hairline bg-surface px-3 py-2 text-ui text-body">
                <span className="flex min-w-0 items-center gap-2">
                  <CheckboxBox
                    checked={acceptedNames.includes(variable.name)}
                    disabled={disabled}
                    onChange={(checked) => toggle(variable.name, checked)}
                  />
                  <span className="truncate font-mono text-ui">{variable.name}</span>
                </span>
                <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
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
          className="flex items-center justify-between gap-2 rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
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
    <div className="space-y-2">
      <InstrumentLabel className="text-body">Outputs</InstrumentLabel>
      <p className="max-w-[66ch] text-ui text-muted">
        Evaluated when the run finishes and returned beside the results.
      </p>
      {outputs.map((output, index) => {
        const taken = new Set(outputs.filter((_, i) => i !== index).map((entry) => entry.name));
        const problem = argumentNameProblem(output.name, taken);
        return (
          <div
            key={index}
            className="space-y-2 rounded-control border border-hairline bg-surface p-3"
          >
            <div className="flex items-end gap-2">
              <Field label="Name" error={problem} className="flex-1">
                <TextInput
                  value={output.name}
                  disabled={disabled}
                  className="font-mono text-ui"
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

type BranchesEditorProps = {
  branches: PipelineRouterBranch[];
  onChange: (branches: PipelineRouterBranch[]) => void;
  env: StaticEnvironment;
  disabled: boolean;
};

/** Move the entry at `index` by `offset`, or return the list unchanged at an end. */
function reordered(
  branches: PipelineRouterBranch[],
  index: number,
  offset: number,
): PipelineRouterBranch[] {
  const target = index + offset;
  if (target < 0 || target >= branches.length) return branches;
  const next = [...branches];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** What a control calls a branch: its name, falling back to its position —
 * mirrors `branch_label` in `app/pipelines/nodes/routing.py`. */
const branchLabel = (branch: PipelineRouterBranch, index: number) =>
  branch.name.trim() || `branch ${index + 1}`;

/**
 * Edits the router's branches: each one an output port and the test that
 * fills it. Order is the semantics — branches are tried top to bottom — so
 * the rows reorder in place rather than only being added and removed.
 *
 * A branch's `id` is minted once and never edited: it is what the output port
 * key is built from, so rewriting it would disconnect every edge already
 * drawn to that branch. Renaming only changes the port's label.
 */
export function BranchesEditor({ branches, onChange, env, disabled }: BranchesEditorProps) {
  const itemEnv = withItemScope(env);
  const update = (index: number, patch: Partial<PipelineRouterBranch>) => {
    onChange(branches.map((branch, i) => (i === index ? { ...branch, ...patch } : branch)));
  };

  return (
    <div className="space-y-2">
      <InstrumentLabel className="text-body">Branches</InstrumentLabel>
      <p className="max-w-[66ch] text-ui text-muted">
        Each branch is an output port carrying a test over the item. Branches are tried top to
        bottom and the first one that holds takes the item; the rest leave through Unmatched.
      </p>
      {branches.map((branch, index) => {
        const label = branchLabel(branch, index);
        return (
          <div
            key={branch.id}
            className="space-y-2 rounded-control border border-hairline bg-surface p-3"
          >
            <div className="flex items-end gap-2">
              <Field label="Name" className="min-w-0 flex-1">
                <TextInput
                  value={branch.name}
                  disabled={disabled}
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || index === 0}
                aria-label={`Move ${label} up`}
                onClick={() => onChange(reordered(branches, index, -1))}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || index === branches.length - 1}
                aria-label={`Move ${label} down`}
                onClick={() => onChange(reordered(branches, index, 1))}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`Delete ${label}`}
                onClick={() => onChange(branches.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <ExpressionInput
              aria-label={`Expression for ${label}`}
              value={branch.expression}
              onChange={(expression) => update(index, { expression })}
              env={itemEnv}
              expectedType="boolean"
              placeholder="item.has_image"
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
          onChange([
            ...branches,
            { id: createId(), name: `Branch ${branches.length + 1}`, expression: "" },
          ])
        }
      >
        Add branch
      </Button>
    </div>
  );
}
