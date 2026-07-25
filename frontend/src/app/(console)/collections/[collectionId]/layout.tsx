"use client";

import { ArrowUpRight } from "lucide-react";
import { useParams, usePathname } from "next/navigation";

import {
  CollectionProvider,
  useCollection,
} from "@/components/collections/detail/collection-context";
import { ButtonLink } from "@/components/ui/button-link";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { SectionTabs } from "@/components/ui/tabs";
import { formatTimeAgoCompact } from "@/lib/format";
import { useAppConfig } from "@/providers/config-provider";

import type { Crumb } from "@/components/ui/crumb-bar";
import type { SectionTab } from "@/components/ui/tabs";
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
  const { config } = useAppConfig();
  const base = `/collections/${collection.id}`;
  const section = sectionLabel(pathname ?? "", base);

  const crumbs: Crumb[] = [
    { label: "Collections", href: "/collections" },
    section ? { label: collection.name, href: base } : { label: collection.name },
    ...(section ? [{ label: section }] : []),
  ];

  const tabs: SectionTab[] = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/files`, label: "Files" },
    { href: `${base}/search`, label: "Search" },
    { href: `${base}/diagnostics`, label: "Diagnostics" },
    ...(config.features.umap_visualizations === false
      ? []
      : [{ href: `${base}/visualize`, label: "Visualize" }]),
  ];

  return (
    <>
      {/* The breadcrumb path owns the collection's identity, so nothing below
          repeats it. Sections are tabs, not a second sidebar — two sidebars
          fight for the same edge. */}
      <CrumbBar
        crumbs={crumbs}
        state={
          <InstrumentLabel>
            {`Updated ${formatTimeAgoCompact(collection.updated_at)}`}
          </InstrumentLabel>
        }
        actions={
          <ButtonLink href={`/chat?collections=${encodeURIComponent(collection.id)}`}>
            Open in Chat studio
            <ArrowUpRight className="h-3.5 w-3.5 text-muted" aria-hidden />
          </ButtonLink>
        }
      />
      <SectionTabs tabs={tabs} />
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">{children}</div>
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
