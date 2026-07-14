"use client";

import { ConnectionsManager } from "@/components/connections/ConnectionsManager";
import { useConnections, useProviderTypes } from "@/components/connections/hooks/use-connections";
import { LoginSessionsPanel } from "@/components/settings/LoginSessionsPanel";
import { GlassCard } from "@/components/ui/panel";
import { useAuth } from "@/providers/auth-provider";

export default function SettingsPage() {
  const { token, loading: authLoading } = useAuth();
  const authToken = token ?? "";
  const { connections, connectionsLoading, connectionsError, reloadConnections } = useConnections(
    authToken,
    authLoading,
  );
  const { providerTypes, providerTypesError } = useProviderTypes(authToken, authLoading);

  return (
    <div className="space-y-6">
      <div>
        <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.4em] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-violet" aria-hidden />
          Settings
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-primary">
          Provider connections
        </h1>
        <p className="mt-2 text-sm text-muted">
          Stored per user. Each connection serves embeddings, chat, or a vector database.
        </p>
      </div>

      <GlassCard className="rounded-3xl p-6">
        <ConnectionsManager
          authToken={authToken}
          connections={connections}
          providerTypes={providerTypes}
          loading={connectionsLoading}
          error={connectionsError ?? providerTypesError}
          onChanged={reloadConnections}
        />
      </GlassCard>
      <LoginSessionsPanel />
    </div>
  );
}
