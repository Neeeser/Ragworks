"use client";

import Link from "next/link";
import { useState } from "react";

import { ProviderDrawer } from "@/components/models/ProviderDrawer";

import type { ConnectionCatalogError } from "@/lib/types";

interface UnreachableProviderNoticeProps {
  error: ConnectionCatalogError;
}

/**
 * A connection that failed to list its models, sitting in the catalog as one of
 * its providers.
 *
 * It is a drawer like every other provider, reporting its state where the
 * others report a count: the failure belongs to this connection, and a red
 * panel across the list reads as an alarm about the whole catalog when the rest
 * of it loaded fine. Collapsed by default — the head already says which
 * provider is down, and the provider's own message is what the user opens it
 * for.
 */
export function UnreachableProviderNotice({ error }: UnreachableProviderNoticeProps) {
  const [open, setOpen] = useState(false);

  return (
    <ProviderDrawer
      connectionLabel={error.connection_label}
      providerType={error.provider_type}
      trailing={<span className="shrink-0 text-instrument text-data-neg">Unreachable</span>}
      open={open}
      onToggle={() => setOpen((current) => !current)}
    >
      <div className="space-y-1 px-2 py-1">
        <p className="break-words text-instrument text-muted">{error.message}</p>
        <Link
          href="/settings"
          className="inline-block text-instrument text-accent-cyan transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
        >
          Manage connection
        </Link>
      </div>
    </ProviderDrawer>
  );
}
