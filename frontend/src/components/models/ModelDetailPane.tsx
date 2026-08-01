"use client";

import { ChevronLeft, Star } from "lucide-react";

import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { CapabilityIcon } from "@/components/models/CapabilityIcon";
import { Button } from "@/components/ui/button";
import { formatContextLength, formatPricePerMillion } from "@/lib/format";
import { MODEL_CAPABILITIES, deriveCapabilities } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";

import type { CatalogModel } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-hairline bg-surface px-3 py-2">
      <p className="text-instrument text-muted">{label}</p>
      <p className="font-mono text-ui tabular-nums text-primary">{value}</p>
    </div>
  );
}

/**
 * Everything known about one model: what it can do, how big its context is,
 * what it costs, and — for embedding models — the vector width it produces.
 *
 * Capability chips are split by direction so "reads images" and "produces
 * images" are never mistaken for each other; text is stated explicitly here
 * (unlike the rows, where it is the unbadged baseline) because this pane is
 * where a user checks what a model actually accepts.
 */
export function ModelDetailPane({
  model,
  selected,
  pinned,
  onTogglePin,
  onSelect,
  onBack,
}: {
  model: CatalogModel;
  selected: boolean;
  pinned: boolean;
  onTogglePin: (model: CatalogModel) => void;
  onSelect: (model: CatalogModel) => void;
  /** Mobile only: returns from the detail sheet to the list. */
  onBack?: () => void;
}) {
  const capabilities = deriveCapabilities(model);
  const inputs = MODEL_CAPABILITIES.filter(
    (capability) => capability.direction === "input" && capabilities.includes(capability.id),
  );
  const outputs = MODEL_CAPABILITIES.filter(
    (capability) => capability.direction === "output" && capabilities.includes(capability.id),
  );
  const prompt = formatPricePerMillion(model.pricing?.prompt);
  const completion = formatPricePerMillion(model.pricing?.completion);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            aria-label="Back to model list"
            onClick={onBack}
            className="shrink-0 rounded-control p-1 text-muted hover:text-primary lg:hidden"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <ProviderIcon providerType={model.provider_type} className="h-6 w-6 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-head font-semibold tracking-[-0.01em] text-primary">
            {model.name}
          </h3>
          <p className="truncate text-instrument text-meta">
            {model.connection_label} · <span className="font-mono">{model.id}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label={pinned ? `Unpin ${model.name}` : `Pin ${model.name}`}
          aria-pressed={pinned}
          onClick={() => onTogglePin(model)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-control border px-3 py-1.5 text-instrument transition-colors duration-80 ease-standard",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
            pinned
              ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
              : "border-hairline text-muted hover:border-strong hover:text-body",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", pinned && "fill-current")} aria-hidden />
          {pinned ? "Pinned" : "Pin"}
        </button>
      </div>

      {model.description ? (
        <p className="max-w-[66ch] text-ui text-body">{model.description}</p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-cyan/25 bg-accent-cyan/8 px-2 py-1 text-instrument text-accent-cyan">
          Text in
        </span>
        {inputs.map((capability) => (
          <span
            key={capability.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent-cyan/25 bg-accent-cyan/8 px-2 py-1 text-instrument text-accent-cyan"
          >
            <CapabilityIcon capability={capability.id} decorative />
            {capability.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-violet/25 bg-accent-violet/10 px-2 py-1 text-instrument text-accent-violet">
          Text out
        </span>
        {outputs.map((capability) => (
          <span
            key={capability.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent-violet/25 bg-accent-violet/10 px-2 py-1 text-instrument text-accent-violet"
          >
            <CapabilityIcon capability={capability.id} decorative />
            {capability.label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {model.context_length ? (
          <Stat label="Context" value={formatContextLength(model.context_length)} />
        ) : null}
        {model.dimension ? (
          <Stat label="Dimension" value={model.dimension.toLocaleString()} />
        ) : null}
        {model.max_input_tokens ? (
          <Stat label="Max input" value={model.max_input_tokens.toLocaleString()} />
        ) : null}
        {prompt ? <Stat label="Prompt $/M" value={prompt} /> : null}
        {completion ? <Stat label="Completion $/M" value={completion} /> : null}
      </div>

      <div className="mt-auto pt-2">
        <Button type="button" className="w-full" onClick={() => onSelect(model)}>
          {selected ? "Keep this model" : "Use this model"}
        </Button>
      </div>
    </div>
  );
}
