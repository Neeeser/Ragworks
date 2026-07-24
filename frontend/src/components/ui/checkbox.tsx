"use client";

import { Check } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/**
 * A labelled checkbox on the shared design tokens. The native input carries the
 * accessible state and keyboard behavior; the visual box mirrors it via peer
 * styling so the control follows the product theme.
 */
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
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-md border border-hairline bg-surface outline-none transition checked:border-accent-violet checked:bg-accent-violet focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed"
        />
        <Check
          aria-hidden
          className="pointer-events-none h-3 w-3 text-canvas opacity-0 transition peer-checked:opacity-100"
        />
      </span>
      <div className="space-y-1">
        <label htmlFor={id} className="block cursor-pointer text-sm text-body">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-xs text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
