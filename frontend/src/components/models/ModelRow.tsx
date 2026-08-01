"use client";

import { Check, Star } from "lucide-react";

import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { CapabilityIcons } from "@/components/models/CapabilityIcon";
import { deriveCapabilities } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";

import type { CatalogModel } from "@/lib/types";
import type { KeyboardEvent, ReactNode } from "react";

export interface ModelRowProps {
  model: CatalogModel;
  selected: boolean;
  onSelect: (model: CatalogModel) => void;
  /** Whether this model is pinned; omit the handler to hide the star entirely. */
  pinned?: boolean;
  onTogglePin?: (model: CatalogModel) => void;
  /** Trailing datum — context length for chat, dimension for embeddings. */
  trailing?: ReactNode;
  /** Show the provider logomark on the row (off inside a provider drawer). */
  showProviderIcon?: boolean;
  /** Second line under the name; defaults to the model id. */
  subtitle?: ReactNode;
  /** Dim the row and mark it unavailable — a pin whose model left the catalog. */
  unavailable?: boolean;
}

/**
 * One selectable model: provider mark, name and id, capability marks, a
 * trailing measure, and the pin star.
 *
 * A `div` with button semantics rather than a `<button>`, because the star is
 * itself a button and buttons cannot nest — nesting them is invalid HTML that
 * hydrates unpredictably. Keyboard activation is wired by hand for the same
 * reason.
 */
export function ModelRow({
  model,
  selected,
  onSelect,
  pinned = false,
  onTogglePin,
  trailing,
  showProviderIcon = true,
  subtitle,
  unavailable = false,
}: ModelRowProps) {
  const capabilities = deriveCapabilities(model);
  const activate = () => {
    if (!unavailable) {
      onSelect(model);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={model.name}
      aria-disabled={unavailable || undefined}
      onClick={activate}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-control border px-3 py-2 text-left transition-colors duration-80 ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        selected
          ? "border-accent-violet/40 bg-accent-violet/12 ring-1 ring-inset ring-accent-violet/30"
          : "border-hairline bg-surface hover:border-strong hover:bg-surface-strong",
        unavailable && "cursor-not-allowed opacity-60",
      )}
    >
      {showProviderIcon ? (
        <ProviderIcon providerType={model.provider_type} className="h-4 w-4 shrink-0 text-muted" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium text-primary">{model.name}</span>
        {/* A model id is a literal — mono, verbatim, never re-cased. */}
        <span className="block truncate text-instrument text-meta">
          {subtitle ?? <span className="font-mono">{model.id}</span>}
        </span>
      </span>
      <CapabilityIcons capabilities={capabilities} />
      {trailing ? (
        <span className="shrink-0 font-mono text-instrument tabular-nums text-muted">
          {trailing}
        </span>
      ) : null}
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent-violet" aria-hidden /> : null}
      {onTogglePin ? (
        <button
          type="button"
          aria-label={pinned ? `Unpin ${model.name}` : `Pin ${model.name}`}
          aria-pressed={pinned}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin(model);
          }}
          className={cn(
            "shrink-0 rounded-chip p-0.5 transition-colors duration-80 ease-standard",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            pinned ? "text-accent-cyan" : "text-faint hover:text-muted",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", pinned && "fill-current")} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
