"use client";

import { cn } from "@/lib/utils";

/** One segment. `disabled` states a choice the current data can't support. */
export type SegmentedOption<T extends string> = {
  id: T;
  label: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (id: T) => void;
  /** Names the choice the strip makes — required, since the labels don't. */
  "aria-label": string;
  className?: string;
};

/**
 * A small set of mutually exclusive view options as one pill strip: a time
 * range, a percentile, a render mode.
 *
 * `role="group"` of `aria-pressed` buttons rather than a `role="tablist"`: these
 * switch how one region reads, they do not swap panels, and a tablist would
 * promise arrow-key panel navigation that isn't there. `TabList` is the right
 * primitive when there really are panels.
 *
 * Every segment is a real tab stop, so the choice is reachable by keyboard
 * without a roving-tabindex convention the surrounding toolbars don't use.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-surface p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-full px-3 py-1 text-instrument font-medium transition-colors duration-80 ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
              "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              "disabled:cursor-not-allowed disabled:text-faint disabled:hover:text-faint",
              active ? "bg-accent-violet/12 text-primary" : "text-muted hover:text-primary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
