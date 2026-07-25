"use client";

import { useMemo, useState } from "react";

import { ApiKeyRow } from "@/components/mcp/ApiKeyRow";
import { ConnectAgentDialog } from "@/components/mcp/ConnectAgentDialog";
import { HarnessMarkRow } from "@/components/mcp/HarnessMark";
import { useApiKeys } from "@/components/mcp/hooks/use-api-keys";
import { mcpEndpointUrl } from "@/components/mcp/lib/connection";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyBlock } from "@/components/ui/copy-block";
import { GlassCard } from "@/components/ui/panel";
import { API_BASE_URL } from "@/lib/api";
import { useOrigin } from "@/lib/use-origin";
import { useAppConfig } from "@/providers/config-provider";

import type { ApiKey } from "@/lib/types/api-keys";
import type { Collection } from "@/lib/types/collections";

type McpAccessCardProps = {
  collection: Collection;
  token: string;
};

/**
 * This collection as an MCP server: its endpoint, the keys that reach it, and
 * the action that issues one.
 *
 * The listing is every unrevoked key whose scope includes this collection, so it
 * answers "who can reach this" rather than "what was issued from this page".
 */
export function McpAccessCard({ collection, token }: McpAccessCardProps) {
  const { config } = useAppConfig();
  const { keys, loading, error, busy, create, revoke } = useApiKeys(token);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);
  const origin = useOrigin();

  const scopedKeys = useMemo(
    () =>
      keys.filter((key) => key.revoked_at === null && key.collection_ids.includes(collection.id)),
    [keys, collection.id],
  );

  // Empty until hydration, so the endpoint block is simply absent server-side.
  const endpoint = origin ? mcpEndpointUrl(origin, collection.id, API_BASE_URL) : "";

  if (config.features.mcp_access === false) return null;

  return (
    <GlassCard className="rounded-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">MCP</p>
          <HarnessMarkRow />
        </div>
        <Button type="button" onClick={() => setDialogOpen(true)}>
          Connect an agent
        </Button>
      </div>

      <p className="mt-3 text-sm text-body leading-relaxed">
        Agent harnesses reach this collection&apos;s tools over MCP at this endpoint, using an API
        key.
      </p>

      {endpoint && <CopyBlock className="mt-4" label="Endpoint" value={endpoint} inline />}

      {error && <p className="mt-4 text-sm text-data-neg">{error}</p>}

      {!loading && scopedKeys.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No key reaches this collection yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {scopedKeys.map((key) => (
            <li key={key.id}>
              <ApiKeyRow apiKey={key} busy={busy} onRevoke={setPendingRevoke} />
            </li>
          ))}
        </ul>
      )}

      <ConnectAgentDialog
        open={dialogOpen}
        collection={collection}
        endpoint={endpoint}
        busy={busy}
        error={error}
        onCreate={create}
        onClose={() => setDialogOpen(false)}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={`Revoke ${pendingRevoke?.name ?? "this key"}?`}
        description="Any agent using this key loses access immediately."
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={busy}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => {
          const target = pendingRevoke;
          setPendingRevoke(null);
          if (target) void revoke(target.id);
        }}
      />
    </GlassCard>
  );
}
