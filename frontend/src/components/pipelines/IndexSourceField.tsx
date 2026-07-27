"use client";

import { useState } from "react";

import { IndexBackendIcon } from "@/components/pipelines/icons/IndexBackendIcon";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { VARIABLE_NAME_PATTERN } from "@/components/pipelines/lib/variable-env";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { ParameterFieldCard } from "@/components/ui/parameter-controls";

import type { IndexBackend, PipelineVariable, VectorIndex } from "@/lib/types";

/** The sentinel the variable select uses to declare a new one. */
const NEW_VARIABLE_SENTINEL = "__new_variable__";

type IndexSourceFieldProps = {
  /** Registered indexes already filtered to this node's backend and plane. */
  indexes: VectorIndex[];
  backend: IndexBackend;
  /** The literal index name in config, empty when the node names none. */
  indexValue: string;
  /** The index variable this node reads, or null when it names one directly. */
  variableName: string | null;
  /** Index variables the definition already declares. */
  variables: PipelineVariable[];
  disabled?: boolean;
  onPickIndex: (name: string) => void;
  onBindVariable: (name: string) => void;
  onDeclareVariable: (name: string) => void;
  onOpenIndexRegistry?: () => void;
};

/**
 * Where this node's index comes from.
 *
 * A node names its index, the same way it names its model — the index's width
 * is decided by the embedder beside it, so the graph is where that choice
 * belongs and reading the graph tells you where data lands. Naming it once as
 * a pipeline variable is the alternative for a graph whose several nodes hit
 * one store: the value still lives in the definition, so a reader still knows
 * where the data goes, but it is written down once instead of per node.
 */
export function IndexSourceField({
  indexes,
  backend,
  indexValue,
  variableName,
  variables,
  disabled,
  onPickIndex,
  onBindVariable,
  onDeclareVariable,
  onOpenIndexRegistry,
}: IndexSourceFieldProps) {
  const bound = variableName !== null;
  // Choosing the source only *shows* the matching control; nothing is written
  // until a variable is picked or declared. Rewriting on the toggle would
  // discard the index the node names before the user has said what replaces
  // it — and that literal is what a new variable is built from.
  const [picked, setPicked] = useState<"named" | "variable" | null>(null);
  const mode = picked ?? (bound ? "variable" : "named");
  const [declaring, setDeclaring] = useState(false);
  const [draftName, setDraftName] = useState("");

  const selectedIndex = indexes.find((index) => index.name === indexValue) ?? null;
  const nameTaken = variables.some((variable) => variable.name === draftName.trim());
  const nameValid = VARIABLE_NAME_PATTERN.test(draftName.trim()) && !nameTaken;

  const handleVariableChange = (value: string) => {
    if (value === NEW_VARIABLE_SENTINEL) {
      setDeclaring(true);
      return;
    }
    onBindVariable(value);
  };

  const declare = () => {
    onDeclareVariable(draftName.trim());
    setDraftName("");
    setDeclaring(false);
  };

  return (
    <ParameterFieldCard
      label="Index"
      description="The vector index this node reads from or writes to."
      helper={
        mode === "variable"
          ? "Named once for this pipeline"
          : indexValue
            ? selectedIndex?.dimension
              ? `Dimension: ${selectedIndex.dimension}`
              : "Dimension: n/a"
            : "Required"
      }
      actionLabel={mode === "variable" ? undefined : "Manage"}
      actionDisabled={disabled}
      onAction={mode === "variable" ? undefined : onOpenIndexRegistry}
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Index source">
          <SourceOption
            label="This pipeline"
            hint="Named here"
            active={mode === "named"}
            disabled={disabled}
            onSelect={() => {
              setPicked("named");
              setDeclaring(false);
              // Coming back is the deliberate unbind: the node stops reading
              // the variable and names an index again.
              if (bound) onPickIndex("");
            }}
          />
          <SourceOption
            label="Pipeline variable"
            hint="Named once, shared"
            active={mode === "variable"}
            disabled={disabled}
            onSelect={() => {
              setPicked("variable");
              if (variables.length === 0) setDeclaring(true);
            }}
          />
        </div>

        {mode === "variable" ? (
          <CustomSelect
            value={variableName ?? ""}
            onValueChange={handleVariableChange}
            disabled={disabled}
            aria-label="Index variable"
            placeholder="Pick a variable"
            options={[
              ...variables.map((variable) => ({ value: variable.name, label: variable.name })),
              {
                value: NEW_VARIABLE_SENTINEL,
                label: "+ New variable…",
                preventFocusRestore: true,
              },
            ]}
          />
        ) : (
          <CustomSelect
            value={indexValue}
            onValueChange={onPickIndex}
            disabled={disabled}
            aria-label="Vector index"
            placeholder="Select an index"
            options={[
              { value: "", label: "Select an index" },
              ...(indexValue && !selectedIndex
                ? [
                    {
                      value: indexValue,
                      label: `${indexValue} (not created yet)`,
                      icon: <IndexBackendIcon backend={backend} />,
                    },
                  ]
                : []),
              ...indexes.map((index) => ({
                value: index.name,
                label: `${index.name}${
                  typeof index.dimension === "number" ? ` · ${index.dimension}d` : ""
                }`,
                icon: <IndexBackendIcon backend={index.backend} />,
              })),
              {
                value: CREATE_SENTINEL,
                label: "+ Add new index...",
                preventFocusRestore: true,
              },
            ]}
          />
        )}

        {declaring ? (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field
                label="Variable name"
                hint={nameTaken ? "Already declared" : "Lowercase, underscores"}
              >
                <TextInput
                  value={draftName}
                  placeholder="memories_semantic"
                  disabled={disabled}
                  onChange={(event) => setDraftName(event.target.value)}
                />
              </Field>
            </div>
            <Button variant="secondary" disabled={disabled || !nameValid} onClick={declare}>
              Add variable
            </Button>
          </div>
        ) : null}
      </div>
    </ParameterFieldCard>
  );
}

type SourceOptionProps = {
  label: string;
  hint: string;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

function SourceOption({ label, hint, active, disabled, onSelect }: SourceOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-control border px-2 py-2 text-left transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet ${
        active
          ? "border-accent-violet/70 bg-accent-violet/10 text-primary"
          : "border-hairline bg-surface text-body hover:border-strong"
      }`}
    >
      <span className="block truncate text-ui">{label}</span>
      <span className="block truncate text-instrument text-meta">{hint}</span>
    </button>
  );
}
