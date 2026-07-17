"use client";

import { useMemo } from "react";

import { inputClass } from "@/components/ui/field";
import { ExpressionError, checkType, evaluate, parse, references } from "@/lib/expressions";
import { cn } from "@/lib/utils";

import { formatPreviewValue } from "./lib/variable-env";

import type { StaticEnvironment } from "./lib/variable-env";
import type { ExprType } from "@/lib/expressions";

type ExpressionFeedback =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; type: ExprType; preview: string };

export function evaluateExpressionFeedback(
  source: string,
  env: StaticEnvironment,
  options: { expectedType?: ExprType | null; staticOnly?: boolean } = {},
): ExpressionFeedback {
  if (!source.trim()) return { kind: "empty" };
  try {
    const expression = parse(source);
    const type = checkType(expression, env.types);
    const expected = options.expectedType;
    if (expected && type !== expected && !(type === "integer" && expected === "number")) {
      return { kind: "error", message: `Expected ${expected}, got ${type}.` };
    }
    if (!expected && type === "model") {
      return { kind: "error", message: "Dereference with .connection_id or .model_name." };
    }
    if (options.staticOnly) {
      const tainted = [...references(expression)].filter((name) => env.tainted.has(name));
      if (tainted.length > 0) {
        return {
          kind: "error",
          message: `Identity field: cannot depend on caller input (${tainted.join(", ")}).`,
        };
      }
    }
    return { kind: "ok", type, preview: formatPreviewValue(evaluate(expression, env.values)) };
  } catch (error) {
    if (error instanceof ExpressionError) {
      return { kind: "error", message: error.message };
    }
    throw error;
  }
}

type ExpressionInputProps = {
  id?: string;
  value: string;
  onChange: (source: string) => void;
  env: StaticEnvironment;
  /** Expression type the target accepts; null/undefined = any scalar. */
  expectedType?: ExprType | null;
  /** Identity field: live-reject references to caller input. */
  staticOnly?: boolean;
  placeholder?: string;
  "aria-label"?: string;
};

/**
 * A monospace expression editor with live type checking and a value preview
 * computed against the static environment (argument defaults + variables).
 */
export function ExpressionInput({
  id,
  value,
  onChange,
  env,
  expectedType,
  staticOnly,
  placeholder,
  "aria-label": ariaLabel,
}: ExpressionInputProps) {
  const feedback = useMemo(
    () => evaluateExpressionFeedback(value, env, { expectedType, staticOnly }),
    [value, env, expectedType, staticOnly],
  );
  const names = useMemo(
    () => [...env.types.keys()].filter((name) => !env.problems.has(name)),
    [env],
  );

  return (
    <div className="space-y-1.5">
      <input
        id={id}
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder ?? "top_k * 2"}
        aria-label={ariaLabel}
        aria-invalid={feedback.kind === "error"}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, "font-mono text-[13px]")}
      />
      {feedback.kind === "error" ? (
        <p className="text-xs text-data-neg">{feedback.message}</p>
      ) : feedback.kind === "ok" ? (
        <p className="font-mono text-xs text-meta">= {feedback.preview}</p>
      ) : names.length > 0 ? (
        <p className="text-xs text-meta">Variables: {names.join(", ")}</p>
      ) : null}
    </div>
  );
}
