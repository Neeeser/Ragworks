"use client";

import { cn } from "@/lib/utils";

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
};

type TabListProps<T extends string> = {
  tabs: Array<TabItem<T>>;
  active: T;
  onSelect: (id: T) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
};

/**
 * Shared tab strip: instrument-styled `role="tablist"` buttons. Panels stay
 * with the caller — render the active panel with `role="tabpanel"` and
 * `aria-labelledby={tabId(id)}`.
 */
export function TabList<T extends string>({
  tabs,
  active,
  onSelect,
  label,
  className,
}: TabListProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex items-center gap-1 rounded-full border border-hairline bg-surface p-1",
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const index = tabs.findIndex((item) => item.id === active);
              const offset = event.key === "ArrowRight" ? 1 : -1;
              const next = tabs[(index + offset + tabs.length) % tabs.length];
              onSelect(next.id);
              document.getElementById(tabId(next.id))?.focus();
            }}
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.28em] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              selected ? "bg-surface-strong text-primary" : "text-muted hover:text-body",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** Stable DOM id for a tab button — pair with `aria-labelledby` on the panel. */
export function tabId(id: string): string {
  return `tab-${id}`;
}
