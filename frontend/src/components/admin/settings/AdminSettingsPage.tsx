"use client";

import { ADMIN_CRUMB, AdminTabs } from "@/components/admin/AdminTabs";
import { useAdminConfig } from "@/components/admin/hooks/use-admin-config";
import { ConfigFieldControl } from "@/components/admin/settings/ConfigFieldControl";
import { DiagnosticsExportCard } from "@/components/admin/settings/DiagnosticsExportCard";
import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";

function titleCase(section: string): string {
  return section
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Section cards at the shape the catalog will fill, so nothing reflows. */
function SettingsSkeleton() {
  return (
    <>
      {[0, 1].map((section) => (
        <div key={section} aria-busy className="card-surface">
          <div className="border-b border-hairline px-3 py-2">
            <Skeleton className="h-3 w-24" />
          </div>
          {[0, 1, 2].map((field) => (
            <div key={field} className="space-y-2 border-b border-hairline p-3 last:border-b-0">
              <Skeleton className="h-2 w-32" />
              <Skeleton className="h-8 w-full max-w-xl" />
              <Skeleton className="h-2 w-56" />
            </div>
          ))}
        </div>
      ))}
      <span className="sr-only">Loading settings</span>
    </>
  );
}

/** Admin-only, schema-driven settings page.

One card per catalog section, derived from the catalog's key prefixes, so new
backend config fields — or whole new sections — appear here automatically.
Edits accumulate across sections and save together from the top bar, which is
where the page's state and actions live. */
export function AdminSettingsPage() {
  const {
    sections,
    loading,
    loadError,
    error,
    success,
    saving,
    dirtyCount,
    setDraft,
    draftValue,
    saveAll,
    discardAll,
    reset,
  } = useAdminConfig();

  const fields = Array.from(sections.values()).flat();
  const overridden = fields.filter((field) => field.source !== "default").length;

  return (
    <>
      <CrumbBar
        crumbs={[ADMIN_CRUMB, { label: "Settings" }]}
        state={
          // What the deployment currently differs on, until an edit is pending —
          // then the bar owns the edit instead.
          <InstrumentLabel>
            {dirtyCount > 0
              ? `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}`
              : `${fields.length} settings · ${overridden} overridden`}
          </InstrumentLabel>
        }
        actions={
          dirtyCount > 0 ? (
            <>
              <Button size="sm" variant="ghost" disabled={saving} onClick={discardAll}>
                Discard
              </Button>
              <Button size="sm" glow loading={saving} onClick={saveAll}>
                Save changes
              </Button>
            </>
          ) : null
        }
      />
      <AdminTabs />
      <PageBody className="flex flex-col gap-3">
        {(loadError || error) && (
          <p role="alert" className="text-ui text-data-neg">
            {loadError || error}
          </p>
        )}
        {success && (
          <p role="status" className="text-ui text-data-pos">
            {success}
          </p>
        )}

        {loading ? (
          <SettingsSkeleton />
        ) : (
          <>
            {Array.from(sections.entries()).map(([section, fields]) => (
              <section
                key={section}
                aria-labelledby={`config-section-${section}`}
                className="card-surface"
              >
                <div className="border-b border-hairline px-3 py-2">
                  <h2
                    id={`config-section-${section}`}
                    className="text-head font-semibold tracking-[-0.01em] text-primary"
                  >
                    {titleCase(section)}
                  </h2>
                </div>
                {fields.map((field) => (
                  <div key={field.key} className="border-b border-hairline p-3 last:border-b-0">
                    <ConfigFieldControl
                      field={field}
                      value={draftValue(field)}
                      onChange={(value) => setDraft(field.key, value)}
                      onReset={() => reset(field.key)}
                      resetting={saving}
                    />
                  </div>
                ))}
              </section>
            ))}
            <DiagnosticsExportCard />
          </>
        )}
      </PageBody>
    </>
  );
}
