"use client";

import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { ParameterInputKind } from "@/lib/types";
import type { ReactNode } from "react";

export type ParameterSelectOption = {
  label: string;
  value: string;
};

type ParameterFieldCardProps = {
  label: string;
  description?: string | null;
  helper?: string | null;
  error?: string | null;
  errorId?: string;
  controlId?: string;
  overrideActive?: boolean;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  children: ReactNode;
};

export function ParameterFieldCard({
  label,
  description,
  helper,
  error,
  errorId,
  controlId,
  overrideActive,
  actionLabel,
  actionDisabled,
  onAction,
  children,
}: ParameterFieldCardProps) {
  return (
    <div className="space-y-2 rounded-control border border-hairline bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label htmlFor={controlId} className="text-ui font-medium text-primary">
              {label}
            </label>
            {/* A square node dot, like every other state marker in the console. */}
            {overrideActive && (
              <span aria-hidden className="h-1.5 w-1.5 rounded-[2px] bg-data-pos" />
            )}
          </div>
          {description ? <p className="max-w-[66ch] text-ui text-muted">{description}</p> : null}
          {helper ? <p className="text-instrument text-meta">{helper}</p> : null}
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            className="shrink-0 rounded-control px-1 text-ui text-muted transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet disabled:opacity-40"
            disabled={actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={errorId} className="text-ui text-data-neg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type ParameterInputProps = {
  input: ParameterInputKind;
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  options?: ParameterSelectOption[];
  rows?: number;
  booleanLabel?: string;
  disabled?: boolean;
  id?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  /** Extra classes merged onto the control (e.g. unrounding an edge a welded addon joins). */
  className?: string;
  onChange: (value: string | boolean) => void;
};

// The one canonical control recipe — a second hand-written copy is how the
// config drawer's fields drifted out of step with every other input in the
// app. The stronger fill is the only deviation: these controls sit inside a
// `bg-surface` field card, where the default fill would vanish into it.
const inputClasses = cn(
  inputClass,
  "bg-surface-strong disabled:cursor-not-allowed disabled:opacity-60",
);

export function ParameterInput({
  input,
  value,
  min,
  max,
  step,
  placeholder,
  options,
  rows,
  booleanLabel = "Enable",
  disabled,
  id,
  ariaInvalid,
  ariaDescribedBy,
  className,
  onChange,
}: ParameterInputProps) {
  if (input === "number" || input === "integer") {
    return (
      <input
        id={id}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        type="number"
        min={min}
        max={max}
        step={step ?? (input === "integer" ? 1 : 0.05)}
        className={cn(inputClasses, className)}
        placeholder={placeholder}
        value={typeof value === "number" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (input === "boolean") {
    return (
      <label className="flex items-center gap-2 text-ui text-body">
        <input
          id={id}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          type="checkbox"
          className="h-4 w-4 rounded-chip border-strong bg-transparent accent-[var(--accent-violet)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{booleanLabel}</span>
      </label>
    );
  }

  if (input === "select") {
    return (
      <select
        id={id}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        className={cn(inputClasses, className)}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {(options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const useTextarea = input === "list" || input === "json" || (rows && rows > 1);
  if (useTextarea) {
    return (
      <textarea
        id={id}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        className={cn(inputClasses, "h-auto", className)}
        rows={rows ?? 2}
        placeholder={placeholder}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      id={id}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      type="text"
      className={cn(inputClasses, className)}
      placeholder={placeholder}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
