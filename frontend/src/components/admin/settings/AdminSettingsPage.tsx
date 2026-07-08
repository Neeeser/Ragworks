"use client";

import { useAdminConfig } from "@/components/admin/hooks/use-admin-config";
import { ConfigFieldControl } from "@/components/admin/settings/ConfigFieldControl";
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
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="text-sm text-slate-400">
          Runtime application configuration. Env-pinned values are read-only here.
        </p>
      </div>

      {(loadError || error) && (
        <p
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {loadError || error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          {success}
        </p>
      )}

      {loading ? (
        <p className="px-1 py-6 text-sm text-slate-400">Loading settings…</p>
      ) : (
        <div className="space-y-10">
          {Array.from(sections.entries()).map(([section, fields]) => (
            <section key={section} aria-labelledby={`config-section-${section}`}>
              <h2
                id={`config-section-${section}`}
                className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400"
              >
                {titleCase(section)}
              </h2>
              <div className="mt-2 divide-y divide-white/5 border-t border-white/5">
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
        </div>
      )}

      {dirtyCount > 0 && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-900/95 px-5 py-3 shadow-xl backdrop-blur">
            <p className="text-sm text-slate-300">
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
