"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  /** Rendered before the label; decorative, so the label carries the name. */
  icon?: ReactNode;
  /** The tab exists but cannot be selected in the current state. */
  disabled?: boolean;
  /**
   * Why it cannot be selected, shown as a `Tooltip` on the tab. Without it a
   * disabled tab is a dead control the user has to guess at.
   */
  disabledReason?: string;
};

type TabListProps<T extends string> = {
  tabs: Array<TabItem<T>>;
  active: T;
  onSelect: (id: T) => void;
  /** Accessible name for the tab list. */
  label: string;
  /**
   * Size each tab to its label and wrap onto further lines instead of sharing
   * one line equally. Set this past ~4 tabs: the default stretch-to-fill truncates
   * ("Claude Code" became "CLAUD…"), and a clipped label names nothing.
   */
  wrap?: boolean;
  className?: string;
};

/**
 * Shared tab strip: instrument-styled `role="tablist"` buttons. Panels stay
 * with the caller — render the active panel with `role="tabpanel"` and
 * `aria-labelledby={tabId(id)}`.
 *
 * A tab the current state can't offer carries `aria-disabled` rather than the
 * `disabled` attribute, so it stays focusable and its `disabledReason` tooltip
 * is reachable by keyboard — a `disabled` button can't take focus, which leaves
 * a keyboard user with a dead tab and no way to read why.
 */
export function TabList<T extends string>({
  tabs,
  active,
  onSelect,
  label,
  wrap = false,
  className,
}: TabListProps<T>) {
  const itemClass = wrap ? "shrink-0" : "min-w-0 flex-1 truncate";
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex items-center gap-1 rounded-full border border-hairline bg-surface p-1",
        wrap && "flex-wrap justify-center rounded-panel",
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const reason = tab.disabled ? tab.disabledReason : undefined;
        const button = (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-disabled={tab.disabled || undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!tab.disabled) onSelect(tab.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              // Indexed from the tab that took the key, not from `active`: a
              // focused disabled tab is not the selected one, and arrowing on
              // from it must still step by one.
              const index = tabs.findIndex((item) => item.id === tab.id);
              const offset = event.key === "ArrowRight" ? 1 : -1;
              const next = tabs[(index + offset + tabs.length) % tabs.length];
              if (!next.disabled) onSelect(next.id);
              document.getElementById(tabId(next.id))?.focus();
            }}
            className={cn(
              // min-w-0 + truncate keep a pill inside the rounded strip at any
              // sidebar width — flex items otherwise refuse to shrink below
              // their label and the selected pill escapes the container.
              "rounded-full px-3 py-1.5 text-instrument font-medium transition-colors",
              reason ? "w-full truncate" : itemClass,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              tab.disabled
                ? "cursor-not-allowed text-faint"
                : selected
                  ? "bg-surface-strong text-primary"
                  : "text-muted hover:text-body",
            )}
          >
            {tab.icon ? (
              <span className="flex min-w-0 items-center justify-center gap-1.5">
                {tab.icon}
                <span className="truncate">{tab.label}</span>
              </span>
            ) : (
              tab.label
            )}
          </button>
        );

        // The tooltip's trigger takes the flex role so the strip's geometry is
        // the same whether or not a tab explains itself.
        return reason ? (
          <Tooltip key={tab.id} content={reason} side="bottom" triggerClassName={itemClass}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

/** Stable DOM id for a tab button — pair with `aria-labelledby` on the panel. */
export function tabId(id: string): string {
  return `tab-${id}`;
}

export type SectionTab = {
  href: string;
  label: string;
  /** Match this tab only on an exact pathname (the section's index route). */
  exact?: boolean;
};

/**
 * Route-level section tabs (a collection's Overview / Files / Search /
 * Diagnostics / Visualize): a 36px strip under the top bar whose active tab
 * carries the trace-wire underline — and the wire *slides* between tabs
 * (160ms, decel) because the strip lives in a layout that survives the route
 * change.
 *
 * The wire's geometry is written straight to the DOM node rather than state:
 * a measurement effect that set state would re-render for nothing and trips
 * the set-state-in-effect lint this repo burns down.
 */
export function SectionTabs({ tabs, className }: { tabs: SectionTab[]; className?: string }) {
  const pathname = usePathname() ?? "";
  const listRef = useRef<HTMLElement>(null);
  const wireRef = useRef<HTMLSpanElement>(null);
  const settled = useRef(false);

  const activeHref = tabs.reduce<string | null>((best, tab) => {
    const matches = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
    if (!matches) return best;
    return best === null || tab.href.length > best.length ? tab.href : best;
  }, null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const wire = wireRef.current;
    if (!list || !wire) return;
    const active = list.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      wire.style.opacity = "0";
      return;
    }
    // First paint lands without a transition so the wire doesn't slide in
    // from the far edge on mount; every later move slides.
    wire.style.transitionProperty = settled.current ? "left, width" : "none";
    wire.style.opacity = "1";
    wire.style.left = `${active.offsetLeft + 10}px`;
    wire.style.width = `${active.offsetWidth - 20}px`;
    settled.current = true;
  }, [activeHref]);

  return (
    <nav
      ref={listRef}
      aria-label="Sections"
      className={cn(
        // The strip scrolls itself once the sections outgrow the width: a
        // fixed-height row of tabs cannot wrap, so without this the labels
        // spill past the viewport and take the whole page's width with them.
        "relative flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline px-4",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              // shrink-0 so a label keeps its width inside the scroller rather
              // than being squeezed to fit and truncating the section's name.
              "shrink-0 rounded-control px-2.5 py-1 text-ui transition-colors duration-80 ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
              active ? "font-medium text-primary" : "text-muted hover:text-primary",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
      <span
        ref={wireRef}
        aria-hidden
        className="trace-wire-x absolute bottom-0 h-[2px] rounded-full opacity-0 duration-160 ease-decel motion-reduce:transition-none"
        style={{ left: 0, width: 0 }}
      />
    </nav>
  );
}
