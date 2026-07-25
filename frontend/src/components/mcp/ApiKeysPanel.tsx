"use client";

import { useState } from "react";

import {
  ApiKeyRow,
  KEY_EXPIRES_COL,
  KEY_PREFIX_COL,
  KEY_USED_COL,
} from "@/components/mcp/ApiKeyRow";
import { useApiKeys } from "@/components/mcp/hooks/use-api-keys";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { useAuth } from "@/providers/auth-provider";

import type { ApiKey } from "@/lib/types/api-keys";

const COLUMN_WIDTHS = [KEY_PREFIX_COL, KEY_USED_COL, KEY_EXPIRES_COL];

/**
 * Every API key this user holds, with revocation.
 *
 * Keys are issued from a collection's MCP card, where the endpoint they are for
 * is in front of the user; this panel is the account-wide view of what exists
 * and the one place to withdraw it. The sentence saying where to create one is
 * the only text kept: the panel has no create action, so nothing else on screen
 * can point at it.
 */
export function ApiKeysPanel() {
  const { token } = useAuth();
  const { keys, loading, error, busy, revoke } = useApiKeys(token ?? "");
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);

  if (!token) return null;

  return (
    <section aria-labelledby="api-keys-heading" className="card-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <h2
          id="api-keys-heading"
          className="text-head font-semibold tracking-[-0.01em] text-primary"
        >
          API keys
        </h2>
        <InstrumentLabel>Issued from a collection&apos;s MCP card</InstrumentLabel>
      </div>

      {error && (
        <p role="alert" className="border-b border-hairline p-3 text-ui text-data-neg">
          {error}
        </p>
      )}

      <DataRowHeader
        title="Key"
        hasLeading
        columns={[
          <InstrumentLabel key="prefix" className={KEY_PREFIX_COL}>
            Prefix
          </InstrumentLabel>,
          <InstrumentLabel key="used" className={KEY_USED_COL}>
            Used
          </InstrumentLabel>,
          <InstrumentLabel key="expires" className={KEY_EXPIRES_COL}>
            Expires
          </InstrumentLabel>,
        ]}
      />

      {loading ? (
        <DataRowSkeleton
          label="Loading API keys"
          hasLeading
          hasSubtitle
          columnWidths={COLUMN_WIDTHS}
        />
      ) : keys.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">No keys yet.</p>
      ) : (
        keys.map((key) => (
          <ApiKeyRow key={key.id} apiKey={key} busy={busy} onRevoke={setPendingRevoke} />
        ))
      )}

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
    </section>
  );
}
