"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { AddConnectionDialog } from "@/components/connections/AddConnectionDialog";
import { ConnectionRow } from "@/components/connections/ConnectionRow";
import { EditConnectionDialog } from "@/components/connections/EditConnectionDialog";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { deleteConnection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { invalidateModelCatalogs } from "@/lib/model-catalog-cache";
import { useProviderReachability } from "@/lib/use-provider-reachability";
import { useAuth } from "@/providers/auth-provider";

import type { ProviderConnection, ProviderKind, ProviderTypeInfo } from "@/lib/types";
import { isConnectionUsable } from "@/lib/connections";

interface ConnectionsManagerProps {
  authToken: string;
  connections: ProviderConnection[];
  providerTypes: ProviderTypeInfo[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  /**
   * Panel heading. Settings passes "Provider connections" so the panel is
   * findable among its titled siblings; the setup wizard omits it because the
   * step's own copy already names the task.
   */
  title?: string;
}

/** A loading row at the real row's geometry, so landing data reflows nothing. */
function ConnectionSkeletonRow() {
  return (
    <div className="flex items-center gap-3 border-b border-hairline px-3 py-2 last:border-b-0">
      <Skeleton className="h-[7px] w-[7px] rounded-[2px]" />
      <Skeleton className="h-4 w-4" />
      <Skeleton className="h-3 max-w-48 flex-1" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

/**
 * The generic provider-connections surface shared by Settings and the setup
 * wizard: configured connections and built-in providers as rows in one card,
 * plus the data-driven add flow. Deleting is a ConfirmDialog — downstream
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
  title,
}: ConnectionsManagerProps) {
  const { user } = useAuth();
  // The same catalog failures the model pickers show, so this page states the
  // reason a picker sent the user here instead of looking healthy.
  const reachability = useProviderReachability(user?.id, authToken);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ProviderConnection | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const builtins = providerTypes.filter((type) => type.builtin);
  const showSkeleton = loading && connections.length === 0;
  const isEmpty = !loading && connections.length === 0 && builtins.length === 0;

  const providerLabelFor = (providerType: string) =>
    providerTypes.find((type) => type.provider_type === providerType)?.label ?? providerType;

  const handleChanged = () => {
    if (user?.id) invalidateModelCatalogs(user.id, authToken);
    onChanged();
  };

  const handleRemove = async () => {
    if (!pendingRemoval) return;
    setRemovingId(pendingRemoval.id);
    setActionError(null);
    try {
      await deleteConnection(authToken, pendingRemoval.id);
      handleChanged();
    } catch (removeError) {
      setActionError(getErrorMessage(removeError, "Unable to remove the connection."));
    } finally {
      setRemovingId(null);
      setPendingRemoval(null);
    }
  };

  return (
    <>
      {/* shrink-0 because overflow-hidden zeroes a flex item's automatic
          minimum size: inside PageBody's flex column, a long sibling (many
          login sessions) collapsed this panel to its 2px of borders. */}
      {/* @container: the rows below lay themselves out against this card's own
          width, so the same panel reads as one line on the settings page and
          stacks inside the setup wizard's narrow step card. */}
      <Panel className="@container shrink-0 overflow-hidden">
        {title ? (
          <PanelHeader
            title={title}
            end={
              <div className="flex items-center gap-3">
                <span className="text-instrument text-meta">
                  <span className="font-mono tabular-nums">{connections.length}</span> configured
                </span>
                <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add provider
                </Button>
              </div>
            }
          />
        ) : (
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2">
            <span className="text-instrument text-meta">
              <span className="font-mono tabular-nums">{connections.length}</span> configured
            </span>
            <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add provider
            </Button>
          </div>
        )}

        {error ? <p className="px-3 py-2 text-ui text-data-neg">{error}</p> : null}
        {actionError ? <p className="px-3 py-2 text-ui text-data-neg">{actionError}</p> : null}

        {showSkeleton ? (
          <>
            <ConnectionSkeletonRow />
            <ConnectionSkeletonRow />
          </>
        ) : null}

        {connections.map((connection) => (
          <ConnectionRow
            key={connection.id}
            connection={connection}
            providerLabel={providerLabelFor(connection.provider_type)}
            authToken={authToken}
            onEdit={setEditing}
            onRemove={setPendingRemoval}
            removing={removingId === connection.id}
            syncError={reachability.byConnectionId.get(connection.id)?.message ?? null}
          />
        ))}

        {builtins.map((type) => (
          <div
            key={type.provider_type}
            className="flex flex-col gap-2 border-b border-hairline px-3 py-2 last:border-b-0 @3xl:flex-row @3xl:items-center @3xl:gap-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <StatusDot tone={type.available ? "pos" : "neg"} />
              <ProviderIcon
                providerType={type.provider_type}
                className="h-4 w-4 shrink-0 text-muted"
              />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-ui font-medium text-primary">{type.label}</span>
                <Chip dot={false}>Built in</Chip>
                {type.available ? null : <Chip tone="neg">Unavailable</Chip>}
              </div>
            </div>
            <div className="shrink-0">
              <ProviderKindBadges kinds={type.kinds} />
            </div>
          </div>
        ))}

        {isEmpty ? (
          <div className="p-8 text-center">
            <p className="text-ui text-muted">No providers connected yet.</p>
          </div>
        ) : null}
      </Panel>

      {editing && (
        <EditConnectionDialog
          connection={editing}
          providerType={providerTypes.find((type) => type.provider_type === editing.provider_type)}
          authToken={authToken}
          onClose={() => setEditing(null)}
          onUpdated={handleChanged}
        />
      )}
      <AddConnectionDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        authToken={authToken}
        providerTypes={providerTypes}
        existingConnections={connections}
        onCreated={handleChanged}
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
    </>
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
    reranking: false,
    vector_store: false,
  };
  for (const connection of connections) {
    // Listed-but-unusable rows report their potential kinds for visibility
    // only; they cannot serve models, so they never satisfy coverage.
    if (!isConnectionUsable(connection)) continue;
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
