"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

export type CommandItem = {
  id: string;
  label: string;
  /** Grouping header, e.g. "Sections", "Collections". */
  group: string;
  href: string;
  /** Extra words that should match the query but aren't displayed. */
  keywords?: string;
};

type CommandPaletteProps = {
  items: CommandItem[];
};

function score(item: CommandItem, query: string): boolean {
  const haystack = `${item.label} ${item.group} ${item.keywords ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/**
 * ⌘K navigation.
 *
 * An accelerator, never the only route — every destination reachable here is
 * also reachable by clicking, because an open-source tool a stranger is
 * evaluating cannot hide its navigation behind a shortcut.
 */
export function CommandPalette({ items }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  // The query resets on the open *event* rather than in an effect keyed on
  // `open`: setState in an effect body causes a cascading render, and the lint
  // override for that rule is a burn-down list this must not join. Focus is
  // handled by `autoFocus` — ModalOverlay unmounts its children when closed, so
  // the input genuinely mounts fresh on every open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          setOpen(false);
          return;
        }
        setQuery("");
        setCursor(0);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const results = useMemo(
    () => (query ? items.filter((item) => score(item, query)) : items),
    [items, query],
  );

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <ModalOverlay open={open} onClose={() => setOpen(false)} labelledBy="command-palette-label">
      <div className="w-full max-w-lg overflow-hidden rounded-panel border border-hairline bg-canvas-raised">
        <label htmlFor="command-palette-input" className="sr-only" id="command-palette-label">
          Search sections and collections
        </label>
        <input
          id="command-palette-input"
          // The palette exists to receive typing immediately; focusing it is the
          // whole interaction.
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((prev) => Math.min(prev + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((prev) => Math.max(prev - 1, 0));
            } else if (event.key === "Enter" && results[cursor]) {
              event.preventDefault();
              go(results[cursor].href);
            }
          }}
          placeholder="Go to…"
          className="w-full border-b border-hairline bg-transparent px-3 py-2 text-ui text-primary outline-none placeholder:text-meta"
        />
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-ui text-muted">No matches.</li>
          ) : (
            results.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(item.href)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-ui transition-colors duration-80 ease-standard",
                    index === cursor ? "bg-surface-strong text-primary" : "text-body",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <InstrumentLabel>{item.group}</InstrumentLabel>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </ModalOverlay>
  );
}
