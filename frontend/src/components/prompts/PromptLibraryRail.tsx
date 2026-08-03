"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CustomSelect } from "@/components/ui/custom-select";
import { TextInput } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CONTEXT_LABELS } from "./lib/contexts";

import type { PromptRead } from "@/lib/types";

interface PromptLibraryRailProps {
  prompts: PromptRead[];
  loading: boolean;
  selectedId: string | null;
  /** Usage count per prompt id — how many pipelines/sessions reference it. */
  usageCounts: Record<string, number>;
  onSelect: (promptId: string) => void;
  onCreate: () => void;
}

const CONTEXT_FILTER_OPTIONS = [
  { value: "all", label: "All contexts" },
  ...Object.entries(CONTEXT_LABELS).map(([value, label]) => ({ value, label })),
];

interface RailRowProps {
  prompt: PromptRead;
  isActive: boolean;
  usageCount: number;
  showContext: boolean;
  onSelect: (promptId: string) => void;
}

/**
 * One prompt in the rail.
 *
 * The row states what a user navigates by — the name, its version, and
 * whether anything actually runs it. The source badge is gone because the
 * group heading already says it, and the context badge only appears while
 * the list is unfiltered, where it still distinguishes rows.
 */
function RailRow({ prompt, isActive, usageCount, showContext, onSelect }: RailRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(prompt.id)}
        aria-current={isActive ? "true" : undefined}
        className={cn(
          "w-full rounded-control px-2 py-2 text-left transition-colors duration-80 ease-standard",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
          isActive ? "bg-accent-violet/12" : "hover:bg-surface",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn("truncate text-ui", isActive ? "font-medium text-primary" : "text-body")}
          >
            {prompt.name}
          </span>
          <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
            v{prompt.current_version}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {showContext && <Chip tone="neutral">{CONTEXT_LABELS[prompt.context]}</Chip>}
          {usageCount > 0 && (
            <span className="text-instrument text-meta">
              In use · {usageCount} {usageCount === 1 ? "place" : "places"}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

/** The library list: search, context filter, yours before the built-ins. */
export function PromptLibraryRail({
  prompts,
  loading,
  selectedId,
  usageCounts,
  onSelect,
  onCreate,
}: PromptLibraryRailProps) {
  const [search, setSearch] = useState("");
  const [contextFilter, setContextFilter] = useState("all");

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const visible = prompts.filter((prompt) => {
      if (contextFilter !== "all" && prompt.context !== contextFilter) return false;
      if (!needle) return true;
      return (
        prompt.name.toLowerCase().includes(needle) ||
        (prompt.description ?? "").toLowerCase().includes(needle)
      );
    });
    // Yours first: the built-ins are a fixed catalogue you read once, while
    // your own prompts are what an editing session actually moves between.
    return [
      { label: "Yours", prompts: visible.filter((prompt) => prompt.source === "user") },
      { label: "Built-in", prompts: visible.filter((prompt) => prompt.source === "shipped") },
    ];
  }, [contextFilter, prompts, search]);

  const total = groups.reduce((count, group) => count + group.prompts.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <TextInput
          aria-label="Search prompts"
          placeholder="Search prompts"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button size="sm" glow onClick={onCreate} aria-label="New prompt">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New
        </Button>
      </div>
      <CustomSelect
        aria-label="Filter by context"
        value={contextFilter}
        placeholder="All contexts"
        options={CONTEXT_FILTER_OPTIONS}
        onValueChange={setContextFilter}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && prompts.length === 0 ? (
          <div className="space-y-2 py-1">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : total === 0 ? (
          <p className="px-2 py-3 text-ui text-muted">No prompts match.</p>
        ) : (
          groups
            .filter((group) => group.prompts.length > 0)
            .map((group) => (
              <section key={group.label} className="pb-2">
                <h2 className="px-2 py-1 text-instrument font-medium text-muted">{group.label}</h2>
                <ul className="divide-y divide-hairline">
                  {group.prompts.map((prompt) => (
                    <RailRow
                      key={prompt.id}
                      prompt={prompt}
                      isActive={prompt.id === selectedId}
                      usageCount={usageCounts[prompt.id] ?? 0}
                      showContext={contextFilter === "all"}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </section>
            ))
        )}
      </div>
    </div>
  );
}
