"use client";

import { Check } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

import type { InputHTMLAttributes, ReactNode } from "react";

type CheckboxBoxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "onChange"
> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * The checkbox control alone — no label, no layout — for callers that own
 * their own row markup (a settings field, a capability card, a variable row).
 *
 * The check glyph is drawn rather than left to the native control: `accent-color`
 * only tints a browser-painted checkbox, so any custom background or border
 * drops the native paint path and with it the checkmark, leaving a filled box
 * that reads the same checked or unchecked. The native input still carries the
 * state and keyboard behavior; the visual box mirrors it via peer styling.
 *
 * Rest props land on the input, so callers pass their own `id`, `name`, and
 * `aria-*` when a wrapper owns labelling.
 */
export function CheckboxBox({ checked, onChange, className, ...inputProps }: CheckboxBoxProps) {
  return (
    <span
      className={cn(
        "relative flex h-5 w-5 shrink-0 items-center justify-center",
        inputProps.disabled && "opacity-60",
        className,
      )}
    >
      <input
        {...inputProps}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-chip border border-hairline bg-surface outline-none transition-colors duration-80 ease-standard checked:border-accent-violet checked:bg-accent-violet focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed motion-reduce:transition-none"
      />
      {/* Full contrast even when disabled: a dimmed glyph on a dimmed box is
          how a checked-but-locked option (an implied capability) comes to read
          as "not granted" — the opposite of what it means. */}
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none relative h-3 w-3 text-canvas opacity-0 transition-opacity duration-80 ease-standard peer-checked:opacity-100 motion-reduce:transition-none"
      />
    </span>
  );
}

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** A labelled checkbox: the shared control plus its label and optional description. */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: CheckboxProps) {
  const id = useId();
  const descriptionId = useId();
  return (
    <div className={cn("flex gap-3", disabled && "opacity-50", className)}>
      <CheckboxBox
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={description ? descriptionId : undefined}
      />
      <div className="space-y-1">
        <label htmlFor={id} className="block cursor-pointer text-ui text-body">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-instrument text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
