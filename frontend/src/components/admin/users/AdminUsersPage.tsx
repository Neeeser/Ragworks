"use client";

import { ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import { useState } from "react";

import { ADMIN_CRUMB, AdminTabs } from "@/components/admin/AdminTabs";
import { useAdminUsers } from "@/components/admin/hooks/use-admin-users";
import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { useAuth } from "@/providers/auth-provider";

import type { AdminUser } from "@/lib/types";

type PendingAction =
  | { kind: "role"; user: AdminUser; nextRole: "admin" | "user" }
  | { kind: "active"; user: AdminUser; nextActive: boolean };

const LAST_ADMIN_HINT = "The last active admin cannot be demoted or deactivated.";

/** One width class per column, shared by the header, the rows, and the skeleton. */
const COL = {
  role: "w-20",
  /** Fits "Deactivated" beside its node dot. */
  status: "w-28",
  collections: "w-20 text-right",
  documents: "w-20 text-right",
};

/** What the confirmation says the pending change will do. */
function confirmCopy(
  action: PendingAction | null,
  viewerId?: string,
): { title: string; description?: string } {
  if (!action) return { title: "" };
  const own = action.user.id === viewerId;
  const description = own
    ? "You are changing your own account."
    : "The change takes effect immediately.";
  if (action.kind === "role") {
    return { title: `Change ${action.user.email} to ${action.nextRole}?`, description };
  }
  const verb = action.nextActive ? "Reactivate" : "Deactivate";
  return { title: `${verb} ${action.user.email}?`, description };
}

/** Admin-only user list with role and activation management. */
export function AdminUsersPage() {
  const { user: viewer } = useAuth();
  const { users, loading, loadError, actionError, pendingUserId, applyUpdate } = useAdminUsers();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // Mirror of the API's invariant (AdminUserService rejects it with a 400):
  // disable the destructive buttons up front instead of letting the click fail.
  const activeAdminCount = users.filter((row) => row.role === "admin" && row.is_active).length;
  const isLastActiveAdmin = (row: AdminUser) =>
    row.role === "admin" && row.is_active && activeAdminCount <= 1;

  const confirmAction = async () => {
    if (!pendingAction) return;
    const patch =
      pendingAction.kind === "role"
        ? { role: pendingAction.nextRole }
        : { is_active: pendingAction.nextActive };
    await applyUpdate(pendingAction.user.id, patch);
    setPendingAction(null);
  };

  const confirm = confirmCopy(pendingAction, viewer?.id);

  return (
    <>
      <CrumbBar
        crumbs={[ADMIN_CRUMB, { label: "Users" }]}
        state={
          loading ? null : (
            <InstrumentLabel>
              {`${users.length} ${users.length === 1 ? "user" : "users"} · ${activeAdminCount} active ${activeAdminCount === 1 ? "admin" : "admins"}`}
            </InstrumentLabel>
          )
        }
      />
      <AdminTabs />
      <PageBody className="flex flex-col gap-3">
        {(loadError || actionError) && (
          <p role="alert" className="text-ui text-data-neg">
            {loadError || actionError}
          </p>
        )}

        {/* flex-1 so the card runs to the bottom of the viewport: sized to its
            rows it floats over bare canvas, which reads as a failed load. */}
        <section aria-label="Users" className="card-surface min-h-0 flex-1">
          <DataRowHeader
            title="Account"
            columns={[
              <InstrumentLabel key="role" className={COL.role}>
                Role
              </InstrumentLabel>,
              <InstrumentLabel key="status" className={COL.status}>
                Status
              </InstrumentLabel>,
              <InstrumentLabel key="collections" className={COL.collections}>
                Collections
              </InstrumentLabel>,
              <InstrumentLabel key="documents" className={COL.documents}>
                Documents
              </InstrumentLabel>,
            ]}
          />
          {loading ? (
            <DataRowSkeleton
              label="Loading users"
              columnWidths={[COL.role, COL.status, COL.collections, COL.documents]}
            />
          ) : users.length === 0 ? (
            <p className="p-8 text-center text-ui text-muted">No users yet.</p>
          ) : (
            users.map((row) => (
              <UserRow
                key={row.id}
                row={row}
                lastActiveAdmin={isLastActiveAdmin(row)}
                pending={pendingUserId === row.id}
                onAct={setPendingAction}
              />
            ))
          )}
        </section>
      </PageBody>

      <ConfirmDialog
        open={pendingAction !== null}
        title={confirm.title}
        description={confirm.description}
        loading={pendingAction ? pendingUserId === pendingAction.user.id : false}
        onConfirm={confirmAction}
        onCancel={() => setPendingAction(null)}
      />
    </>
  );
}

type UserRowProps = {
  row: AdminUser;
  lastActiveAdmin: boolean;
  pending: boolean;
  onAct: (action: PendingAction) => void;
};

/**
 * One account, with its role, access state, and the two account actions.
 *
 * The actions are icon buttons because `DataRow` gives them a fixed slot beside
 * the row's own cells; each carries the action's sentence as its accessible name
 * and a `Tooltip` saying the same thing — or, on the last active admin, the
 * reason the button is disabled.
 */
function UserRow({ row, lastActiveAdmin, pending, onAct }: UserRowProps) {
  const promoting = row.role !== "admin";
  const roleLabel = promoting ? "Make admin" : "Demote to user";
  const activeLabel = row.is_active ? "Deactivate" : "Reactivate";
  const RoleIcon = promoting ? ShieldCheck : ShieldOff;
  const ActiveIcon = row.is_active ? UserX : UserCheck;

  return (
    <DataRow
      title={row.full_name || row.email}
      /* Only when it says something the title doesn't — a row whose name IS the
         email gets no second line repeating it. */
      subtitle={row.full_name ? row.email : undefined}
      columns={[
        <span key="role" className={COL.role}>
          <Chip tone={row.role === "admin" ? "accent" : "neutral"}>
            {row.role === "admin" ? "Admin" : "User"}
          </Chip>
        </span>,
        <StatusDot
          key="status"
          tone={row.is_active ? "pos" : "warn"}
          label={row.is_active ? "Active" : "Deactivated"}
          className={COL.status}
        />,
        <span key="collections" className={`font-mono tabular-nums ${COL.collections}`}>
          {row.collection_count.toLocaleString()}
        </span>,
        <span key="documents" className={`font-mono tabular-nums ${COL.documents}`}>
          {row.document_count.toLocaleString()}
        </span>,
      ]}
      actions={
        <>
          <Tooltip content={lastActiveAdmin ? LAST_ADMIN_HINT : roleLabel} side="left">
            <Button
              size="sm"
              variant="ghost"
              aria-label={roleLabel}
              disabled={lastActiveAdmin}
              loading={pending}
              onClick={() =>
                onAct({ kind: "role", user: row, nextRole: promoting ? "admin" : "user" })
              }
            >
              {pending ? null : <RoleIcon className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </Tooltip>
          <Tooltip content={lastActiveAdmin ? LAST_ADMIN_HINT : activeLabel} side="left">
            <Button
              size="sm"
              variant="ghost"
              aria-label={activeLabel}
              disabled={lastActiveAdmin}
              loading={pending}
              onClick={() => onAct({ kind: "active", user: row, nextActive: !row.is_active })}
            >
              {pending ? null : <ActiveIcon className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </Tooltip>
        </>
      }
    />
  );
}
