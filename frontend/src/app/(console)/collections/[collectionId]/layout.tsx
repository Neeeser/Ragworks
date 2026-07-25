"use client";

import { useParams, usePathname } from "next/navigation";

import {
  CollectionProvider,
  useCollection,
} from "@/components/collections/detail/collection-context";
import { CollectionSidebar } from "@/components/collections/detail/CollectionSidebar";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { formatTimeAgoCompact } from "@/lib/format";

import type { Crumb } from "@/components/ui/crumb-bar";
import type { ReactNode } from "react";

/** The sub-route's own name, for the last breadcrumb segment. */
function sectionLabel(pathname: string, base: string): string | null {
  const rest = pathname.slice(base.length).replace(/^\//, "").split("/")[0];
  if (!rest) return null;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function CollectionShell({ children }: { children: ReactNode }) {
  const { collection } = useCollection();
  const pathname = usePathname();
  const base = `/collections/${collection.id}`;
  const section = sectionLabel(pathname ?? "", base);

  const crumbs: Crumb[] = [
    { label: "Collections", href: "/collections" },
    section ? { label: collection.name, href: base } : { label: collection.name },
    ...(section ? [{ label: section }] : []),
  ];

  return (
    <>
      {/* The breadcrumb owns the collection's identity, so nothing below repeats
          it — the sidebar used to print the name directly beside the page's own
          <h1> saying the same thing. */}
      <CrumbBar
        crumbs={crumbs}
        state={
          <InstrumentLabel>
            {`Updated ${formatTimeAgoCompact(collection.updated_at)}`}
          </InstrumentLabel>
        }
      />
      <div className="flex min-h-0 flex-1">
        <CollectionSidebar collection={collection} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </>
  );
}

export default function CollectionLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ collectionId: string }>();
  return (
    <CollectionProvider collectionId={params.collectionId}>
      <CollectionShell>{children}</CollectionShell>
    </CollectionProvider>
  );
}
