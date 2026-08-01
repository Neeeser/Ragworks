"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { CapabilityIcons } from "@/components/models/CapabilityIcon";
import { useModelShortlist } from "@/components/models/hooks/use-model-shortlist";
import { modelKey } from "@/components/models/model-catalog-filter";
import { ModelBrowserOverlay } from "@/components/models/ModelBrowserOverlay";
import { deriveCapabilities } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";

import type { ModelSortDef } from "@/components/models/model-catalog-filter";
import type { CatalogModel, ShortlistKind } from "@/lib/types";
import type { ReactNode } from "react";

export interface ModelPickerFieldProps {
  kind: ShortlistKind;
  models: CatalogModel[];
  selectedConnectionId?: string | null;
  selectedModelId?: string | null;
  onSelectModel: (model: CatalogModel) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  sortOptions?: ModelSortDef[];
  renderTrailing?: (model: CatalogModel) => ReactNode;
  "aria-label"?: string;
}

/**
 * A model choice that has to fit in a form row: the selected model as a
 * single control, opening the shared {@link ModelBrowserOverlay}.
 *
 * The tabbed inline picker needs a pane; a variable's value sits in a narrow
 * field beside a dozen others. Rather than degrade to a bare dropdown — which
 * is what made this choice a name-and-connection string with no capabilities,
 * no search across providers, and no pins — the field shows the same model
 * identity every other surface shows and hands the actual choosing to the same
 * browser. Pins and recents made here are the ones the other pickers show.
 */
export function ModelPickerField({
  kind,
  models,
  selectedConnectionId,
  selectedModelId,
  onSelectModel,
  disabled = false,
  placeholder = "Pick a model",
  searchPlaceholder = "Search models across providers…",
  emptyLabel = "No models available.",
  sortOptions,
  renderTrailing,
  "aria-label": ariaLabel,
}: ModelPickerFieldProps) {
  const shortlist = useModelShortlist(kind, models);
  const [open, setOpen] = useState(false);

  const selectedKey =
    selectedConnectionId && selectedModelId
      ? modelKey(selectedConnectionId, selectedModelId)
      : null;
  const selected =
    models.find((model) => modelKey(model.connection_id, model.id) === selectedKey) ?? null;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-2 rounded-control border border-hairline bg-surface px-3 py-2 text-left transition-colors duration-80 ease-standard",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          disabled ? "cursor-not-allowed opacity-60" : "hover:border-strong",
        )}
      >
        {selected ? (
          <ProviderIcon
            providerType={selected.provider_type}
            className="h-4 w-4 shrink-0 text-muted"
          />
        ) : null}
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate text-ui text-primary">{selected.name}</span>
              <span className="block truncate text-instrument text-meta">
                {selected.connection_label} · <span className="font-mono">{selected.id}</span>
              </span>
            </>
          ) : selectedModelId ? (
            // No catalog entry resolves it, so the stored id is all there is.
            <span className="block truncate font-mono text-ui text-primary">{selectedModelId}</span>
          ) : (
            <span className="block truncate text-ui text-muted">{placeholder}</span>
          )}
        </span>
        {selected ? <CapabilityIcons capabilities={deriveCapabilities(selected)} /> : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-meta" aria-hidden />
      </button>

      {open ? (
        <ModelBrowserOverlay
          models={models}
          selectedKey={selectedKey}
          onSelect={(model) => {
            onSelectModel(model);
            shortlist.recordUse(model);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          isPinned={shortlist.isPinned}
          onTogglePin={shortlist.togglePin}
          loading={false}
          searchPlaceholder={searchPlaceholder}
          emptyLabel={emptyLabel}
          sortOptions={sortOptions}
          renderTrailing={renderTrailing}
        />
      ) : null}
    </>
  );
}
