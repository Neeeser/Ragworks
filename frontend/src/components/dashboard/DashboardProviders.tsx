import Link from "next/link";

import { ProviderIcon } from "@/components/connections/ProviderIcon";

import type { ConnectionCatalogError } from "@/lib/types";

type DashboardProvidersProps = {
  unreachable: ConnectionCatalogError[];
};

/**
 * Provider connections that failed to answer the last time their models were
 * listed.
 *
 * A dead provider is otherwise only visible to whoever happens to open a model
 * picker, while every pipeline bound to it fails on its next run — so the one
 * page a user lands on states it. Renders nothing when every connection
 * answered: a permanent "all providers reachable" line trains the user to skip
 * the row that matters.
 */
export function DashboardProviders({ unreachable }: DashboardProvidersProps) {
  if (unreachable.length === 0) return null;

  return (
    // A landmark, like the failures region beside it, so a screen reader user
    // can move between the page's regions without reading every row.
    <section aria-label="Unreachable providers" className="card-surface">
      {unreachable.map((entry) => (
        <Link
          key={entry.connection_id}
          href="/settings"
          className="flex items-center gap-2 rounded-control border-b border-hairline px-3 py-2 last:border-b-0 transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
        >
          <ProviderIcon
            providerType={entry.provider_type}
            className="h-3.5 w-3.5 shrink-0 text-data-neg"
          />
          {/* One text flow, so the provider, the state, and the reason read as
              a sentence rather than three fragments in separate columns. */}
          <span className="truncate text-ui text-body">
            <span className="font-medium text-primary">{entry.connection_label}</span> did not
            answer: <span className="text-data-neg">{entry.message}</span>
          </span>
        </Link>
      ))}
    </section>
  );
}
