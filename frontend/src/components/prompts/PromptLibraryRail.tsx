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
  onSelect: (promptId: string) => void;
  onCreate: () => void;
}

const CONTEXT_FILTER_OPTIONS = [
  { value: "all", label: "All contexts" },
  ...Object.entries(CONTEXT_LABELS).map(([value, label]) => ({ value, label })),
];

/** The library list: search, context filter, one row per prompt. */
export function PromptLibraryRail({
  prompts,
  loading,
  selectedId,
  onSelect,
  onCreate,
}: PromptLibraryRailProps) {
  const [search, setSearch] = useState("");
  const [contextFilter, setContextFilter] = useState("all");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return prompts.filter((prompt) => {
      if (contextFilter !== "all" && prompt.context !== contextFilter) return false;
      if (!needle) return true;
      return (
        prompt.name.toLowerCase().includes(needle) ||
        (prompt.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [contextFilter, prompts, search]);

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
        ) : (
          <ul className="divide-y divide-hairline">
            {visible.map((prompt) => {
              const isActive = prompt.id === selectedId;
              return (
                <li key={prompt.id}>
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
                        className={cn(
                          "truncate text-ui",
                          isActive ? "font-medium text-primary" : "text-body",
                        )}
                      >
                        {prompt.name}
                      </span>
                      <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
                        v{prompt.current_version}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Chip tone="neutral">{CONTEXT_LABELS[prompt.context]}</Chip>
                      {prompt.source === "shipped" && <Chip tone="neutral">Built-in</Chip>}
                    </div>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-2 py-3 text-ui text-muted">No prompts match.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
