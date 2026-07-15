"use client";

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
    <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <label htmlFor={controlId} className="text-sm font-semibold text-primary">
              {label}
            </label>
            {overrideActive && <span className="h-2 w-2 rounded-full bg-data-pos" />}
          </div>
          {description ? <p className="text-xs text-muted">{description}</p> : null}
          {helper ? <p className="text-[11px] text-meta">{helper}</p> : null}
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            className="text-xs text-muted transition hover:text-primary disabled:opacity-40"
            disabled={actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={errorId} className="text-xs text-data-neg">
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
  onChange: (value: string | boolean) => void;
};

const inputClasses =
  "w-full rounded-2xl border border-hairline bg-surface-strong px-4 py-3 text-sm text-primary outline-none focus:border-accent-violet focus:ring-2 focus:ring-accent-violet/30 disabled:cursor-not-allowed disabled:opacity-60";

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
        className={inputClasses}
        placeholder={placeholder}
        value={typeof value === "number" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (input === "boolean") {
    return (
      <label className="flex items-center gap-3 text-sm text-body">
        <input
          id={id}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          type="checkbox"
          className="h-4 w-4 rounded border-strong bg-transparent accent-[var(--accent-violet)]"
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
        className={inputClasses}
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
        className={`${inputClasses} h-auto`}
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
      className={inputClasses}
      placeholder={placeholder}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
