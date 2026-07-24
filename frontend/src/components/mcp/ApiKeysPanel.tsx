"use client";

import { useState } from "react";

import { ApiKeyRow } from "@/components/mcp/ApiKeyRow";
import { useApiKeys } from "@/components/mcp/hooks/use-api-keys";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/providers/auth-provider";

import type { ApiKey } from "@/lib/types/api-keys";

/**
 * Every API key this user holds, with revocation.
 *
 * Keys are issued from a collection's MCP card, where the endpoint they are for
 * is in front of the user; this panel is the account-wide view of what exists
 * and the one place to withdraw it.
 */
export function ApiKeysPanel() {
  const { token } = useAuth();
  const { keys, loading, error, busy, revoke } = useApiKeys(token ?? "");
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);

  if (!token) return null;

  return (
    <section className="rounded-3xl border border-hairline bg-surface p-6">
      <h2 className="text-xl font-semibold text-primary">API keys</h2>
      <p className="mt-2 text-sm text-body leading-relaxed">
        Keys agent harnesses use to reach collections over MCP. Create one from a
        collection&apos;s MCP card.
      </p>

      {error && <p className="mt-4 text-sm text-data-neg">{error}</p>}

      {!loading && keys.length === 0 ? (
        <p className="mt-5 text-sm text-muted">No keys yet.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {keys.map((key) => (
            <li key={key.id}>
              <ApiKeyRow apiKey={key} busy={busy} onRevoke={setPendingRevoke} />
            </li>
          ))}
        </ul>
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
