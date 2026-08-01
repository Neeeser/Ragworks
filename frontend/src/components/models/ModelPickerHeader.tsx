"use client";

import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { CapabilityIcons } from "@/components/models/CapabilityIcon";
import { Loader } from "@/components/ui/loader";
import { deriveCapabilities } from "@/lib/model-capabilities";

import type { CatalogModel } from "@/lib/types";
import type { ReactNode } from "react";

/** The selected model no longer resolves in the catalog; kept visible so the user replaces it. */
export interface UnavailableSelection {
  modelId: string;
  connectionLabel?: string | null;
  message?: string | null;
}

/**
 * The picker's selected-model card: provider mark, name, connection-qualified
 * id, and what the model can do.
 *
 * This is the one part of the picker that stays on screen while the pane is
 * used for something else, so it carries the capability marks — a user needs
 * to see that the model they're chatting with reads images without reopening
 * the picker.
 */
export function ModelPickerHeader({
  model,
  placeholder,
  accessory,
  loading,
}: {
  model: CatalogModel | null;
  placeholder: string;
  accessory?: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-control border border-accent-violet/35 bg-accent-violet/8 px-3 py-2">
      {model ? (
        <ProviderIcon
          providerType={model.provider_type}
          className="h-5 w-5 shrink-0 text-accent-violet"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-medium text-primary">
          {model ? model.name : <span className="text-muted">{placeholder}</span>}
        </p>
        {model ? (
          <p className="truncate text-instrument text-meta">
            {model.connection_label} · <span className="font-mono">{model.id}</span>
          </p>
        ) : null}
      </div>
      {model ? <CapabilityIcons capabilities={deriveCapabilities(model)} /> : null}
      {accessory}
      {loading ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-instrument text-muted">
          <Loader className="h-3 w-3" />
          Syncing
        </span>
      ) : null}
    </div>
  );
}

/** The warning shown when the saved selection is gone from the catalog. */
export function UnavailableSelectionNotice({ unavailable }: { unavailable: UnavailableSelection }) {
  return (
    <div className="rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2">
      <p className="text-ui font-medium text-data-warn">Unavailable</p>
      <p className="break-all font-mono text-instrument text-meta">
        {unavailable.connectionLabel
          ? `${unavailable.connectionLabel} · ${unavailable.modelId}`
          : unavailable.modelId}
      </p>
      {unavailable.message ? (
        <p className="mt-1 max-w-[66ch] text-instrument text-muted">{unavailable.message}</p>
      ) : null}
    </div>
  );
}
