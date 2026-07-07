"use client";

import { useAdminConfig } from "@/components/admin/hooks/use-admin-config";
import { ConfigFieldControl } from "@/components/admin/settings/ConfigFieldControl";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";

function titleCase(section: string): string {
  return section
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Admin-only, schema-driven settings page: one card per config section. */
export function AdminSettingsPage() {
  const {
    sections,
    loading,
    loadError,
    error,
    success,
    savingSection,
    setDraft,
    sectionIsDirty,
    draftValue,
    save,
    reset,
  } = useAdminConfig();

  return (
    <div className="space-y-6">
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
        <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </p>
      )}
      {loading ? (
        <p className="px-4 py-6 text-sm text-slate-400">Loading settings…</p>
      ) : (
        Array.from(sections.entries()).map(([section, fields]) => (
          <GlassCard key={section} className="space-y-4 p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">{titleCase(section)}</h2>
              <Button
                size="sm"
                disabled={!sectionIsDirty(section)}
                loading={savingSection === section}
                onClick={() => save(section)}
              >
                Save
              </Button>
            </div>
            <div className="space-y-4">
              {fields.map((field) => (
                <ConfigFieldControl
                  key={field.key}
                  field={field}
                  value={draftValue(field)}
                  onChange={(value) => setDraft(field.key, value)}
                  onReset={() => reset(field.key)}
                  resetting={savingSection === section}
                />
              ))}
            </div>
          </GlassCard>
        ))
      )}
    </div>
  );
}
