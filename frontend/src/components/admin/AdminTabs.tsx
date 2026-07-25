"use client";

import { SectionTabs } from "@/components/ui/tabs";

import type { Crumb } from "@/components/ui/crumb-bar";
import type { SectionTab } from "@/components/ui/tabs";

const ADMIN_TABS: SectionTab[] = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/settings", label: "Settings" },
];

/** First segment of every admin page's breadcrumb path. */
export const ADMIN_CRUMB: Crumb = { label: "Admin", href: "/admin/users" };

/**
 * The admin area's section strip, rendered under each page's own `CrumbBar`.
 *
 * The pages render it rather than the shared layout because a page's top bar
 * carries its own state and actions — the usage window picker, the settings
 * save controls — and those cannot reach a bar owned by the layout above them.
 */
export function AdminTabs() {
  return <SectionTabs tabs={ADMIN_TABS} />;
}
