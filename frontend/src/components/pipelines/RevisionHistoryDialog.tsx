"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ModalOverlay } from "@/components/ui/modal-overlay";

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
    <div className="border-b border-hairline px-3 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-mono text-ui tabular-nums text-primary">v{version.version}</span>
            {isCurrent ? (
              <Chip tone="pos" dot={false}>
                Active
              </Chip>
            ) : null}
          </span>
          {/* Rendered only when present: an absent summary gets no placeholder. */}
          {version.change_summary ? (
            <p className="truncate text-ui text-muted">{version.change_summary}</p>
          ) : null}
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
        <ul className="mt-1 space-y-1">
          {visible.map((change) => (
            <li
              key={`${change.kind}-${change.summary}`}
              className="flex items-start gap-2 text-instrument text-muted"
            >
              <span
                aria-hidden
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-[2px] ${changeKindDot(change.kind)}`}
              />
              <span>{change.summary}</span>
            </li>
          ))}
          {hiddenCount > 0 || expanded ? (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="rounded-control text-instrument text-meta underline-offset-2 transition-colors duration-80 ease-standard hover:text-body hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
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
      <div className="card-surface flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden bg-canvas-raised shadow-elevation-2">
        <h2
          id={titleId}
          className="shrink-0 border-b border-hairline p-3 text-head font-semibold tracking-[-0.01em] text-primary"
        >
          Revision history
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {versions.length === 0 ? (
            <p className="p-8 text-center text-ui text-muted">No revisions yet.</p>
          ) : null}
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
      </div>
    </ModalOverlay>
  );
}
