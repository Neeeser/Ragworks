"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import { diffLines } from "./lib/diff";
import { versionDiffText } from "./lib/version-diff";

import type { PromptDetail, PromptVersionRead } from "@/lib/types";

interface PromptVersionsPanelProps {
  detail: PromptDetail;
  versions: PromptVersionRead[];
  currentVersion: number;
  onRestore: (version: PromptVersionRead) => void;
}

/**
 * Version history with diffs against any other version.
 *
 * The diff covers everything a version holds — the system message and the
 * output-field schema as well as the body — because a version that changed
 * only the system message would otherwise render as "no changes", which
 * reads as a broken diff rather than a real one.
 */
export function PromptVersionsPanel({
  detail,
  versions,
  currentVersion,
  onRestore,
}: PromptVersionsPanelProps) {
  const router = useRouter();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);

  const selected = useMemo(
    () => versions.find((entry) => entry.version === selectedVersion) ?? versions[0] ?? null,
    [selectedVersion, versions],
  );
  // Default to the immediate predecessor; picking a base compares any two.
  const base = useMemo(() => {
    if (!selected) return null;
    const target = baseVersion ?? selected.version - 1;
    return versions.find((entry) => entry.version === target) ?? null;
  }, [baseVersion, selected, versions]);

  const diff = useMemo(() => {
    if (!selected) return [];
    return diffLines(base ? versionDiffText(base) : "", versionDiffText(selected));
  }, [base, selected]);

  if (versions.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
      <div className="max-h-56 overflow-y-auto lg:max-h-none lg:min-h-0">
        <ul className="divide-y divide-hairline">
          {versions.map((entry) => {
            const isActive = entry.version === selected?.version;
            const isBase = entry.version === base?.version;
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
                  {!isActive && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setBaseVersion(isBase ? null : entry.version);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        setBaseVersion(isBase ? null : entry.version);
                      }}
                      className={cn(
                        "mt-1 inline-block rounded-chip border border-hairline px-1.5 text-instrument transition-colors duration-80 ease-standard",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                        isBase ? "border-accent-violet text-accent-violet" : "text-meta",
                      )}
                    >
                      {isBase ? "comparing against" : "compare against"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-1 lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <InstrumentLabel>
            {base
              ? `Changes from v${base.version} to v${selected?.version}`
              : `v${selected?.version} (first version)`}
          </InstrumentLabel>
          {selected && (
            <div className="flex items-center gap-2">
              {base && (
                // The diff says what changed; only a run says whether it
                // helped. This carries both versions into a new eval run.
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    router.push(
                      `/evals?prompt=${detail.id}&version_a=${base.version}&version_b=${selected.version}`,
                    )
                  }
                >
                  Compare in an eval
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onRestore(selected)}>
                Load into editor
              </Button>
            </div>
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
