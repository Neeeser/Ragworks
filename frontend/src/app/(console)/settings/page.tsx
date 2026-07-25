"use client";

import { ConnectionsManager } from "@/components/connections/ConnectionsManager";
import { useConnections, useProviderTypes } from "@/components/connections/hooks/use-connections";
import { ApiKeysPanel } from "@/components/mcp/ApiKeysPanel";
import { AppearancePanel } from "@/components/settings/AppearancePanel";
import { LoginSessionsPanel } from "@/components/settings/LoginSessionsPanel";
import { PageBody } from "@/components/ui/app-shell";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
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
    <>
      <CrumbBar
        crumbs={[{ label: "Settings" }]}
        state={
          connectionsLoading ? null : (
            <InstrumentLabel>
              {`${connections.length} ${connections.length === 1 ? "connection" : "connections"}`}
            </InstrumentLabel>
          )
        }
      />
      <PageBody className="flex flex-col gap-3">
        {/* ConnectionsManager renders its own Panel — wrapping it again nests
            a card in a card (the two Wave-4 conversions landed simultaneously). */}
        <ConnectionsManager
          title="Provider connections"
          authToken={authToken}
          connections={connections}
          providerTypes={providerTypes}
          loading={connectionsLoading}
          error={connectionsError ?? providerTypesError}
          onChanged={reloadConnections}
        />
        <AppearancePanel />
        <LoginSessionsPanel />
        <ApiKeysPanel />
      </PageBody>
    </>
  );
}
