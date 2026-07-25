"use client";

import { CAPABILITY_OPTIONS } from "@/components/mcp/lib/connection";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/datetime";
import { timeAgo } from "@/lib/utils";

import type { ApiKey } from "@/lib/types/api-keys";

type ApiKeyRowProps = {
  apiKey: ApiKey;
  busy: boolean;
  onRevoke: (apiKey: ApiKey) => void;
};

const CAPABILITY_LABELS = new Map(CAPABILITY_OPTIONS.map((option) => [option.value, option.label]));

/** One key's identity, powers, and reach — shared by both key listings. */
export function ApiKeyRow({ apiKey, busy, onRevoke }: ApiKeyRowProps) {
  const revoked = apiKey.revoked_at !== null;
  const powers = apiKey.capabilities
    .map((capability) => CAPABILITY_LABELS.get(capability) ?? capability)
    .join(" · ");
  const reach = apiKey.all_collections
    ? "Every collection"
    : `${apiKey.collection_ids.length} collection${apiKey.collection_ids.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface-strong p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm text-primary">
          {apiKey.name}
          {revoked ? " · Revoked" : ""}
        </p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-meta">
          {apiKey.prefix}… · {reach} · {powers}
        </p>
        <p className="mt-1 text-xs text-muted">
          {apiKey.last_used_at ? `Last used ${timeAgo(apiKey.last_used_at)}` : "Never used"}
          {apiKey.expires_at ? ` · Expires ${formatDate(apiKey.expires_at)}` : ""}
        </p>
      </div>
      {!revoked && (
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          aria-label={`Revoke ${apiKey.name}`}
          onClick={() => onRevoke(apiKey)}
        >
          Revoke
        </Button>
      )}
    </div>
  );
}
