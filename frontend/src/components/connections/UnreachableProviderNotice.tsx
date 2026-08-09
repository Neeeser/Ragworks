"use client";

import Link from "next/link";

import { ProviderIcon } from "@/components/connections/ProviderIcon";

import type { ConnectionCatalogError } from "@/lib/types";

interface UnreachableProviderNoticeProps {
  error: ConnectionCatalogError;
}

/**
 * One connection that failed to list its models, stated where its models would
 * have been.
 *
 * A provider that answers nothing is scoped to itself: the other connections in
 * the same catalog loaded fine, so a notice above the whole picker blames every
 * provider for one being down. The link goes to the connection's settings
 * because the message ("No route to host", "401") is only actionable there.
 */
export function UnreachableProviderNotice({ error }: UnreachableProviderNoticeProps) {
  return (
    <div className="rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <ProviderIcon
          providerType={error.provider_type}
          className="h-4 w-4 shrink-0 text-data-neg"
        />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
          {error.connection_label}
        </span>
        <span className="shrink-0 text-instrument text-data-neg">Unreachable</span>
      </div>
      <p className="mt-1 break-words text-instrument text-muted">{error.message}</p>
      <Link
        href="/settings"
        className="mt-1 inline-block text-instrument text-accent-cyan transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        Manage connection
      </Link>
    </div>
  );
}
