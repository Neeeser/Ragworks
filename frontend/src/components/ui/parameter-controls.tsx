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
  overrideActive,
  actionLabel,
  actionDisabled,
  onAction,
  children,
}: ParameterFieldCardProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{label}</p>
            {overrideActive && (
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            )}
          </div>
          {description ? <p className="text-xs text-slate-400">{description}</p> : null}
          {helper ? <p className="text-[11px] text-slate-500">{helper}</p> : null}
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            className="text-xs text-slate-400 transition hover:text-white disabled:opacity-40"
            disabled={actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
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
  onChange: (value: string | boolean) => void;
};

const inputClasses =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-60";

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
  onChange,
}: ParameterInputProps) {
  if (input === "number" || input === "integer") {
    return (
      <input
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
      <label className="flex items-center gap-3 text-sm text-slate-200">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-white/30 bg-transparent"
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
      type="text"
      className={inputClasses}
      placeholder={placeholder}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
