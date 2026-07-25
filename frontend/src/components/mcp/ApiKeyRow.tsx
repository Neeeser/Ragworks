"use client";

import { CAPABILITY_OPTIONS } from "@/components/mcp/lib/connection";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DataRow } from "@/components/ui/data-row";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";

import type { ApiKey } from "@/lib/types/api-keys";

type ApiKeyRowProps = {
  apiKey: ApiKey;
  busy: boolean;
  onRevoke: (apiKey: ApiKey) => void;
};

const CAPABILITY_LABELS = new Map(CAPABILITY_OPTIONS.map((option) => [option.value, option.label]));

/** Wide enough for the longest prefix the backend issues. */
export const KEY_PREFIX_COL = "w-28 text-right";
export const KEY_USED_COL = "w-16 text-right";
export const KEY_EXPIRES_COL = "w-24 text-right";

/** One key's identity, powers, and reach — shared by both key listings. */
export function ApiKeyRow({ apiKey, busy, onRevoke }: ApiKeyRowProps) {
  const revoked = apiKey.revoked_at !== null;
  // A key normally covers the one collection it was issued from, which its name
  // already says; only a wider reach is worth a chip.
  const reach =
    apiKey.collection_ids.length > 1 ? `${apiKey.collection_ids.length} collections` : null;

  return (
    <DataRow
      leading={<StatusDot tone={revoked ? "neutral" : "pos"} />}
      title={apiKey.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-1">
          {revoked ? <Chip tone="neutral">Revoked</Chip> : null}
          {reach ? (
            <Chip tone="accent" dot={false}>
              {reach}
            </Chip>
          ) : null}
          {apiKey.capabilities.map((capability) => (
            <Chip key={capability} tone="retrieve" dot={false}>
              {CAPABILITY_LABELS.get(capability) ?? capability}
            </Chip>
          ))}
        </span>
      }
      columns={[
        // A key prefix is a literal the user matches against their agent
        // configuration, so it renders verbatim in mono.
        <span
          key="prefix"
          className={`truncate font-mono text-instrument text-meta ${KEY_PREFIX_COL}`}
        >
          {apiKey.prefix}…
        </span>,
        <Tooltip
          key="used"
          content={
            apiKey.last_used_at ? `Last used ${formatDateTime(apiKey.last_used_at)}` : "Never used"
          }
          side="left"
          triggerClassName={`justify-end ${KEY_USED_COL}`}
        >
          <span className="font-mono tabular-nums text-instrument text-meta">
            {apiKey.last_used_at ? formatTimeAgoCompact(apiKey.last_used_at) : "—"}
          </span>
        </Tooltip>,
        // An expiry is a future instant, so it renders as the date itself —
        // a relative "ago" would read as if the key had already lapsed.
        <span
          key="expires"
          className={`truncate font-mono tabular-nums text-instrument text-meta ${KEY_EXPIRES_COL}`}
        >
          {apiKey.expires_at ? formatDate(apiKey.expires_at) : "—"}
        </span>,
      ]}
      actions={
        revoked ? null : (
          <Tooltip content={`Revoke ${apiKey.name}`} side="left">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={busy}
              aria-label={`Revoke ${apiKey.name}`}
              onClick={() => onRevoke(apiKey)}
            >
              Revoke
            </Button>
          </Tooltip>
        )
      }
    />
  );
}
