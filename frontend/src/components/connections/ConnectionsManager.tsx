"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { AddConnectionDialog } from "@/components/connections/AddConnectionDialog";
import { ConnectionCard } from "@/components/connections/ConnectionCard";
import { EditConnectionDialog } from "@/components/connections/EditConnectionDialog";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteConnection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { ProviderConnection, ProviderKind, ProviderTypeInfo } from "@/lib/types";

interface ConnectionsManagerProps {
  authToken: string;
  connections: ProviderConnection[];
  providerTypes: ProviderTypeInfo[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
}

/**
 * The generic provider-connections surface shared by Settings and the setup
 * wizard: configured connections (plus built-in providers like pgvector),
 * and the data-driven add flow. Deleting is a ConfirmDialog — downstream
 * pipelines/sessions referencing a removed connection fail lazily with a
 * clear error, so the confirmation copy says so.
 */
export function ConnectionsManager({
  authToken,
  connections,
  providerTypes,
  loading,
  error,
  onChanged,
}: ConnectionsManagerProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ProviderConnection | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const builtins = providerTypes.filter((type) => type.builtin);

  const handleRemove = async () => {
    if (!pendingRemoval) return;
    setRemovingId(pendingRemoval.id);
    setActionError(null);
    try {
      await deleteConnection(authToken, pendingRemoval.id);
      onChanged();
    } catch (removeError) {
      setActionError(getErrorMessage(removeError, "Unable to remove the connection."));
    } finally {
      setRemovingId(null);
      setPendingRemoval(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
          Provider connections
        </p>
        <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add provider
        </Button>
      </div>
      {error && <p className="text-sm text-data-neg">{error}</p>}
      {actionError && <p className="text-sm text-data-neg">{actionError}</p>}
      {loading && connections.length === 0 ? (
        <p className="text-sm text-muted">Loading connections…</p>
      ) : (
        <div className="@container">
          <div className="grid gap-3 @2xl:grid-cols-2">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                authToken={authToken}
                onEdit={setEditing}
                onRemove={setPendingRemoval}
                removing={removingId === connection.id}
              />
            ))}
            {builtins.map((type) => (
              <div
                key={type.provider_type}
                className="rounded-2xl border border-dashed border-hairline bg-surface/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-hairline bg-canvas-raised text-primary">
                      <ProviderIcon providerType={type.provider_type} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary">{type.label}</p>
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-meta">
                        Built-in · {type.available ? "available" : "unavailable"}
                      </p>
                    </div>
                  </div>
                  <ProviderKindBadges kinds={type.kinds} />
                </div>
              </div>
            ))}
            {connections.length === 0 && builtins.length === 0 && !loading && (
              <p className="text-sm text-muted">No providers connected yet.</p>
            )}
          </div>
        </div>
      )}
      {editing && (
        <EditConnectionDialog
          connection={editing}
          providerType={providerTypes.find((type) => type.provider_type === editing.provider_type)}
          authToken={authToken}
          onClose={() => setEditing(null)}
          onUpdated={() => onChanged()}
        />
      )}
      <AddConnectionDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        authToken={authToken}
        providerTypes={providerTypes}
        existingConnections={connections}
        onCreated={() => onChanged()}
      />
      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remove connection?"
        description={
          pendingRemoval
            ? `Pipelines and chats that use “${pendingRemoval.label}” will stop working until you pick another provider.`
            : ""
        }
        confirmLabel="Remove"
        loading={removingId !== null}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
}

/** Coverage checklist across connections + built-ins (wizard gating). */
export function computeKindCoverage(
  connections: ProviderConnection[],
  providerTypes: ProviderTypeInfo[],
): Record<ProviderKind, boolean> {
  const coverage: Record<ProviderKind, boolean> = {
    embedding: false,
    chat: false,
    vector_store: false,
  };
  for (const connection of connections) {
    for (const kind of connection.kinds) {
      coverage[kind] = true;
    }
  }
  for (const type of providerTypes) {
    if (type.builtin && type.available) {
      for (const kind of type.kinds) {
        coverage[kind] = true;
      }
    }
  }
  return coverage;
}
