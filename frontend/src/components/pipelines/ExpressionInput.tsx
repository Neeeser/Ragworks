"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { inputClass } from "@/components/ui/field";
import { ExpressionError, checkType, evaluate, parse, references } from "@/lib/expressions";
import { cn } from "@/lib/utils";

import {
  applySuggestion,
  buildSuggestions,
  caretToken,
  filterSuggestions,
} from "./lib/expression-suggest";
import { formatPreviewValue } from "./lib/variable-env";
import { SuggestionListbox } from "./SuggestionListbox";

import type { Suggestion } from "./lib/expression-suggest";
import type { StaticEnvironment } from "./lib/variable-env";
import type { ExprType } from "@/lib/expressions";
import type { ReactNode } from "react";

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
  /** Grab focus on mount (literal fields converting to ƒx keep typing flow). */
  autoFocus?: boolean;
  /** Control rendered welded to the input's right edge (e.g. the ƒx toggle). */
  addon?: ReactNode;
  "aria-label"?: string;
};

/**
 * A monospace expression combobox: live type checking, a value preview
 * computed against the static environment, and a suggestion dropdown that
 * opens on focus — every variable (badge, type, current value) plus the
 * builtin functions — filtered by the identifier token at the caret.
 * Accepting a suggestion replaces that token; functions land the caret
 * between their parentheses. Escape closes only the dropdown.
 */
export function ExpressionInput({
  id,
  value,
  onChange,
  env,
  expectedType,
  staticOnly,
  placeholder,
  autoFocus,
  addon,
  "aria-label": ariaLabel,
}: ExpressionInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = `${id ?? "expression"}-suggestions`;

  const feedback = useMemo(
    () => evaluateExpressionFeedback(value, env, { expectedType, staticOnly }),
    [value, env, expectedType, staticOnly],
  );
  const allSuggestions = useMemo(
    () => buildSuggestions(env, { expectedType, staticOnly }),
    [env, expectedType, staticOnly],
  );
  const token = useMemo(() => caretToken(value, caret), [value, caret]);
  const suggestions = useMemo(
    () => filterSuggestions(allSuggestions, token.text),
    [allSuggestions, token.text],
  );

  const syncCaret = () => {
    const position = inputRef.current?.selectionStart;
    if (typeof position === "number") setCaret(position);
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [token.text, open]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // Mount-only: refocus when a literal field converts into this input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = (suggestion: Suggestion) => {
    const applied = applySuggestion(value, token, suggestion);
    onChange(applied.source);
    setCaret(applied.caret);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(applied.caret, applied.caret);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (event.key === "ArrowDown") {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      setActiveIndex((index) => Math.max(index - 1, 0));
      event.preventDefault();
    } else if ((event.key === "Enter" || event.key === "Tab") && suggestions.length > 0) {
      accept(suggestions[activeIndex] ?? suggestions[0]);
      event.preventDefault();
    } else if (event.key === "Escape") {
      setOpen(false);
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div className="space-y-1.5">
      <div className={cn(addon != null && "flex items-stretch")}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && suggestions.length > 0 ? `${listId}-${activeIndex}` : undefined
          }
          placeholder={placeholder ?? "top_k * 2"}
          aria-label={ariaLabel}
          aria-invalid={feedback.kind === "error"}
          onChange={(event) => {
            onChange(event.target.value);
            const position = event.target.selectionStart;
            if (typeof position === "number") setCaret(position);
            setOpen(true);
          }}
          onFocus={() => {
            syncCaret();
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onClick={syncCaret}
          onKeyUp={(event) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
              syncCaret();
            }
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            inputClass,
            "font-mono text-[13px]",
            addon != null && "min-w-0 flex-1 rounded-r-none",
          )}
        />
        {addon}
      </div>
      {open ? (
        <SuggestionListbox
          listId={listId}
          anchorRef={inputRef}
          suggestions={suggestions}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onAccept={accept}
        />
      ) : null}
      {feedback.kind === "error" ? (
        <p className="text-xs text-data-neg">{feedback.message}</p>
      ) : feedback.kind === "ok" ? (
        <p className="font-mono text-xs text-meta">= {feedback.preview}</p>
      ) : null}
    </div>
  );
}
