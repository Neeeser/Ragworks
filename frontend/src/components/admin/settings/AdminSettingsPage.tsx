"use client";

import { useAdminConfig } from "@/components/admin/hooks/use-admin-config";
import { ConfigFieldControl } from "@/components/admin/settings/ConfigFieldControl";
import { DiagnosticsExportCard } from "@/components/admin/settings/DiagnosticsExportCard";
import { Button } from "@/components/ui/button";

function titleCase(section: string): string {
  return section
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Admin-only, schema-driven settings page.

One continuous scrollable list: section headings are dividers derived from the
catalog's key prefixes, so new backend config fields — or whole new sections —
appear here automatically. Edits accumulate across sections and save together
from the sticky bar that appears when anything is dirty. */
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

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-24">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Settings</h1>
        <p className="text-sm text-muted">
          Runtime application configuration. Env-pinned values are read-only here.
        </p>
      </div>

      {(loadError || error) && (
        <p
          role="alert"
          className="rounded-2xl border border-data-neg/30 bg-data-neg/10 px-4 py-3 text-sm text-data-neg"
        >
          {loadError || error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-2xl border border-data-pos/30 bg-data-pos/10 px-4 py-3 text-sm text-data-pos"
        >
          {success}
        </p>
      )}

      {loading ? (
        <p className="px-1 py-6 text-sm text-muted">Loading settings…</p>
      ) : (
        <div className="space-y-10">
          {Array.from(sections.entries()).map(([section, fields]) => (
            <section key={section} aria-labelledby={`config-section-${section}`}>
              <h2
                id={`config-section-${section}`}
                className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted"
              >
                {titleCase(section)}
              </h2>
              <div className="mt-2 divide-y divide-hairline border-t border-hairline">
                {fields.map((field) => (
                  <div key={field.key} className="py-5">
                    <ConfigFieldControl
                      field={field}
                      value={draftValue(field)}
                      onChange={(value) => setDraft(field.key, value)}
                      onReset={() => reset(field.key)}
                      resetting={saving}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
          <DiagnosticsExportCard />
        </div>
      )}

      {dirtyCount > 0 && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-hairline bg-canvas-raised/95 px-5 py-3 shadow-elevation-2 backdrop-blur">
            <p className="text-sm text-body">
              {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={saving} onClick={discardAll}>
                Discard
              </Button>
              <Button size="sm" loading={saving} onClick={saveAll}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
