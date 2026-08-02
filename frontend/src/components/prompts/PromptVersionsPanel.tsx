"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import { diffLines } from "./lib/diff";

import type { PromptVersionRead } from "@/lib/types";

interface PromptVersionsPanelProps {
  versions: PromptVersionRead[];
  currentVersion: number;
  onRestore: (version: PromptVersionRead) => void;
}

/**
 * Version history with line diffs: pick any version to see what changed
 * against the one before it, and load its body back into the editor draft
 * (saving that draft appends a new version — history is immutable).
 */
export function PromptVersionsPanel({
  versions,
  currentVersion,
  onRestore,
}: PromptVersionsPanelProps) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const selected = useMemo(
    () => versions.find((entry) => entry.version === selectedVersion) ?? versions[0] ?? null,
    [selectedVersion, versions],
  );
  const predecessor = useMemo(
    () =>
      selected ? (versions.find((entry) => entry.version === selected.version - 1) ?? null) : null,
    [selected, versions],
  );
  const diff = useMemo(() => {
    if (!selected) return [];
    return diffLines(predecessor?.body ?? "", selected.body);
  }, [predecessor, selected]);

  if (versions.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[220px_1fr]">
      <div className="max-h-56 overflow-y-auto lg:max-h-none lg:min-h-0">
        <ul className="divide-y divide-hairline">
          {versions.map((entry) => {
            const isActive = entry.version === selected?.version;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setSelectedVersion(entry.version)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "w-full rounded-control px-2 py-1.5 text-left transition-colors duration-80 ease-standard",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                    isActive ? "bg-accent-violet/12" : "hover:bg-surface",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-ui tabular-nums text-primary">
                      v{entry.version}
                    </span>
                    {entry.version === currentVersion && (
                      <span className="text-instrument text-accent-cyan">current</span>
                    )}
                  </div>
                  {entry.label && (
                    <p className="truncate text-instrument text-muted">{entry.label}</p>
                  )}
                  <p className="font-mono text-instrument tabular-nums text-meta">
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-1 lg:min-h-0">
        <div className="flex items-center justify-between gap-2">
          <InstrumentLabel>
            {predecessor
              ? `Changes from v${predecessor.version} to v${selected?.version}`
              : `v${selected?.version} (first version)`}
          </InstrumentLabel>
          {selected && (
            <Button size="sm" variant="ghost" onClick={() => onRestore(selected)}>
              Load into editor
            </Button>
          )}
        </div>
        <div className="overflow-auto rounded-control border border-hairline bg-surface lg:min-h-0 lg:flex-1">
          <pre className="min-w-full p-2 font-mono text-instrument leading-5">
            {diff.map((line, index) => (
              <div
                key={index}
                className={cn(
                  "whitespace-pre-wrap px-1",
                  line.kind === "added" && "bg-data-pos/10 text-data-pos",
                  line.kind === "removed" && "bg-data-neg/10 text-data-neg line-through",
                  line.kind === "same" && "text-body",
                )}
              >
                {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
                {line.text}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
