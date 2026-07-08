"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";

import { changeKindDot } from "./lib/change-kind";

import type { PipelineVersion } from "@/lib/types";

type PipelineRevisionsProps = {
  versions: PipelineVersion[];
  currentVersion?: number;
  saving: boolean;
  onActivate: (version: PipelineVersion) => void;
};

const COLLAPSED_CHANGE_COUNT = 3;

/** One revision row: summary, its change list (expandable), and activation. */
function RevisionEntry({
  version,
  isCurrent,
  saving,
  onActivate,
}: {
  version: PipelineVersion;
  isCurrent: boolean;
  saving: boolean;
  onActivate: (version: PipelineVersion) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const changes = version.changes ?? [];
  const visible = expanded ? changes : changes.slice(0, COLLAPSED_CHANGE_COUNT);
  const hiddenCount = changes.length - visible.length;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-white">v{version.version}</p>
          <p
            className="truncate text-xs text-slate-400"
            title={version.change_summary ?? undefined}
          >
            {version.change_summary || "No summary provided."}
          </p>
        </div>
        <Button
          size="sm"
          variant={isCurrent ? "secondary" : "ghost"}
          disabled={isCurrent || saving}
          onClick={() => onActivate(version)}
        >
          {isCurrent ? "Active" : "Activate"}
        </Button>
      </div>
      {changes.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
          {visible.map((change) => (
            <li
              key={`${change.kind}-${change.summary}`}
              className="flex items-start gap-2 text-[11px] text-slate-400"
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${changeKindDot(change.kind)}`}
              />
              <span>{change.summary}</span>
            </li>
          ))}
          {hiddenCount > 0 || expanded ? (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              >
                {expanded ? "Show less" : `Show ${hiddenCount} more`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

export function PipelineRevisions({
  versions,
  currentVersion,
  saving,
  onActivate,
}: PipelineRevisionsProps) {
  return (
    <GlassCard className="rounded-3xl p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Revisions</p>
      <div className="mt-3 space-y-3 text-sm">
        {versions.length === 0 && <p className="text-sm text-slate-400">No revisions loaded.</p>}
        {versions.map((version) => (
          <RevisionEntry
            key={version.id}
            version={version}
            isCurrent={currentVersion === version.version}
            saving={saving}
            onActivate={onActivate}
          />
        ))}
      </div>
    </GlassCard>
  );
}
