"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";

import { changeKindDot } from "./lib/change-kind";

import type { PipelineVersion } from "@/lib/types";

type RevisionHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
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
    <div className="rounded-2xl border border-hairline bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-primary">v{version.version}</p>
          <p className="truncate text-xs text-muted" title={version.change_summary ?? undefined}>
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
        <ul className="mt-2 space-y-1 border-t border-hairline pt-2">
          {visible.map((change) => (
            <li
              key={`${change.kind}-${change.summary}`}
              className="flex items-start gap-2 text-[11px] text-muted"
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
                className="text-[11px] text-meta underline-offset-2 hover:text-body hover:underline"
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

/** Modal listing every saved revision with its generated change notes. */
export function RevisionHistoryDialog({
  open,
  onClose,
  versions,
  currentVersion,
  saving,
  onActivate,
}: RevisionHistoryDialogProps) {
  const titleId = useId();
  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <GlassCard className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-[2rem] border border-hairline bg-canvas-raised/95 p-6">
        <p id={titleId} className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Revision history
        </p>
        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
          {versions.length === 0 ? <p className="text-sm text-muted">No revisions yet.</p> : null}
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
    </ModalOverlay>
  );
}
