"use client";

import { Plus, X } from "lucide-react";

import { CustomSelect } from "@/components/ui/custom-select";
import { TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import type {
  FilterCondition,
  FilterOp,
  FilterScalar,
  MetadataFilter,
  PipelineValidationIssue,
  PipelineVariable,
} from "@/lib/types";

type MetadataFilterFieldProps = {
  config: Record<string, unknown>;
  variables: PipelineVariable[];
  disabled: boolean;
  validationIssues: PipelineValidationIssue[];
  onConfigChange: (config: Record<string, unknown>) => void;
};

const OP_OPTIONS: Array<{ value: FilterOp; label: string }> = [
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
  { value: "in", label: "in" },
  { value: "nin", label: "not in" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "exists", label: "exists" },
];

const LITERAL = "__literal__";

/** Parse "true"/"false" and numbers; everything else stays a string. */
const inferScalar = (raw: string): FilterScalar => {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
};

const scalarToText = (value: FilterScalar | FilterScalar[] | null | undefined): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
};

const filterFromConfig = (config: Record<string, unknown>): FilterCondition[] => {
  const raw = config.filter;
  if (typeof raw !== "object" || raw === null) return [];
  const all = (raw as MetadataFilter).all;
  return Array.isArray(all) ? all : [];
};

/**
 * The retriever's metadata filter: conditions every returned chunk must
 * satisfy, AND-combined. A condition compares against a typed literal
 * (numbers and booleans are inferred from the text) or reads a pipeline
 * variable at query time.
 */
export function MetadataFilterField({
  config,
  variables,
  disabled,
  validationIssues,
  onConfigChange,
}: MetadataFilterFieldProps) {
  const conditions = filterFromConfig(config);
  const issues = validationIssues.filter((issue) => issue.field === "filter");

  const setConditions = (next: FilterCondition[]) => {
    const nextConfig = { ...config };
    if (next.length === 0) {
      delete nextConfig.filter;
    } else {
      nextConfig.filter = { all: next };
    }
    onConfigChange(nextConfig);
  };

  const updateCondition = (index: number, patch: Partial<FilterCondition>) => {
    setConditions(
      conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)),
    );
  };

  const handleValueText = (index: number, condition: FilterCondition, raw: string) => {
    const isList = condition.op === "in" || condition.op === "nin";
    // Entries are not filtered while typing — dropping an empty segment
    // would eat the comma the user just typed mid-list.
    const value = isList
      ? raw.split(",").map((entry) => inferScalar(entry.trim()))
      : inferScalar(raw);
    updateCondition(index, { value, var: null });
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <InstrumentLabel>Metadata filter</InstrumentLabel>
        {!disabled ? (
          <button
            type="button"
            onClick={() => setConditions([...conditions, { field: "", op: "eq", value: "" }])}
            className="flex items-center gap-1 rounded-control px-1.5 py-0.5 text-instrument text-accent-cyan transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            <Plus className="h-3 w-3" aria-hidden />
            Add condition
          </button>
        ) : null}
      </div>
      {conditions.length > 0 ? (
        <p className="mt-1 text-instrument text-meta">
          Every returned chunk must satisfy all conditions. Values may read a pipeline variable,
          bound at query time.
        </p>
      ) : null}
      {issues.map((issue) => (
        <p key={issue.message} role="alert" className="mt-1 text-instrument text-data-neg">
          {issue.message}
        </p>
      ))}
      {conditions.length > 0 ? (
        <div className="mt-2 space-y-2">
          {conditions.map((condition, index) => {
            const usesVariable = typeof condition.var === "string" && condition.var !== "";
            const isExists = condition.op === "exists";
            return (
              <div key={index} className="flex items-center gap-2">
                <TextInput
                  aria-label={`Condition ${index + 1} field`}
                  placeholder="field"
                  value={condition.field}
                  disabled={disabled}
                  className="w-32 shrink-0 font-mono text-ui"
                  onChange={(event) => updateCondition(index, { field: event.target.value })}
                />
                <CustomSelect
                  aria-label={`Condition ${index + 1} operator`}
                  placeholder="op"
                  value={condition.op}
                  disabled={disabled}
                  options={OP_OPTIONS}
                  onValueChange={(value) => {
                    const op = value as FilterOp;
                    updateCondition(
                      index,
                      op === "exists" ? { op, value: null, var: null } : { op },
                    );
                  }}
                  className="w-24 shrink-0"
                />
                {!isExists ? (
                  variables.length > 0 ? (
                    <CustomSelect
                      aria-label={`Condition ${index + 1} value source`}
                      placeholder="Source"
                      value={usesVariable ? (condition.var as string) : LITERAL}
                      disabled={disabled}
                      options={[
                        { value: LITERAL, label: "Literal" },
                        ...variables.map((variable) => ({
                          value: variable.name,
                          label: `var: ${variable.name}`,
                        })),
                      ]}
                      onValueChange={(value) =>
                        updateCondition(
                          index,
                          value === LITERAL
                            ? { var: null, value: "" }
                            : { var: value, value: null },
                        )
                      }
                      className="w-32 shrink-0"
                    />
                  ) : null
                ) : null}
                {!isExists && !usesVariable ? (
                  <TextInput
                    aria-label={`Condition ${index + 1} value`}
                    placeholder={
                      condition.op === "in" || condition.op === "nin" ? "a, b, c" : "value"
                    }
                    value={scalarToText(condition.value)}
                    disabled={disabled}
                    className="min-w-0 flex-1 font-mono text-ui"
                    onChange={(event) => handleValueText(index, condition, event.target.value)}
                  />
                ) : null}
                {!disabled ? (
                  <button
                    type="button"
                    aria-label={`Remove condition ${index + 1}`}
                    onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                    className="shrink-0 rounded-control p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
