"use client";

import { History, Search } from "lucide-react";
import { useMemo } from "react";

import {
  ARGUMENT_NAME_CLASS,
  QueryArgumentControls,
} from "@/components/collections/detail/search/QueryArgumentControls";
import { SearchFailurePanel } from "@/components/collections/detail/search/SearchFailurePanel";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { TextArea, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { PulseWire } from "@/components/ui/pulse-wire";
import { Tooltip } from "@/components/ui/tooltip";

import type { CollectionSearchState } from "@/components/collections/detail/search/use-collection-search";
import type { FormEvent } from "react";

/**
 * Queries already run get re-run from here rather than retyped. Each is the
 * literal text that was sent, so it renders verbatim.
 */
function RecentQueries({ queries, onRun }: { queries: string[]; onRun: (query: string) => void }) {
  if (queries.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Recent queries"
      className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3"
    >
      <History className="h-3.5 w-3.5 shrink-0 text-meta" aria-hidden />
      {queries.map((recent) => (
        <Tooltip key={recent} content={recent} side="bottom">
          <button
            type="button"
            onClick={() => onRun(recent)}
            className="max-w-56 truncate rounded-full border border-hairline bg-surface px-2 py-0.5 text-instrument text-muted transition-colors duration-80 ease-standard hover:border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {recent}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * The query composer: what to run, which tool runs it, and the arguments that
 * tool declares.
 *
 * Everything the run needs lives on one card — the text, its controls, the
 * recent queries it can be replaced with, and whatever the last attempt failed
 * with — because they are one object and not four stacked ones. The pulse runs
 * only while a query is genuinely in flight.
 */
export function SearchComposer({ search }: { search: CollectionSearchState }) {
  const toolOptions = useMemo(
    () =>
      search.tools.map((tool) => ({
        value: tool.id,
        label: tool.is_primary ? `${tool.name} (primary)` : tool.name,
      })),
    [search.tools],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search.run();
  };

  return (
    <Panel className="p-3">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted"
            aria-hidden
          />
          <TextArea
            className="min-h-[72px] pl-9"
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            placeholder="Search this collection…"
            aria-label="Search query"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void search.run();
              }
            }}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {search.tools.length > 1 && (
            <span className="flex items-center gap-2">
              <InstrumentLabel>Tool</InstrumentLabel>
              <CustomSelect
                aria-label="Tool to run"
                value={search.selectedTool?.id ?? ""}
                options={toolOptions}
                placeholder="Select a tool"
                className="w-56 px-2 py-1"
                onValueChange={search.setSelectedToolId}
              />
            </span>
          )}

          {search.argumentsSpec.length > 0 ? (
            <QueryArgumentControls
              argumentsSpec={search.argumentsSpec}
              values={search.argumentValues}
              onChange={search.setArgumentValue}
            />
          ) : search.toolsReady || search.toolsError ? (
            // Rendered only once the tools listing is known (or failed):
            // showing the legacy control while it loads misrepresents a
            // declaring tool for a moment.
            <label className="flex items-center gap-2">
              <span className={ARGUMENT_NAME_CLASS}>top_k</span>
              <TextInput
                type="number"
                min={1}
                max={50}
                value={search.topK}
                onChange={(event) => search.setTopK(Number(event.target.value))}
                className="w-20 px-2 py-1 text-center font-mono tabular-nums"
              />
            </label>
          ) : null}

          <span className="ml-auto flex items-center gap-3">
            {/* The pulse is licensed only while the query is actually running,
                and unmounts the moment it stops. */}
            {search.running ? <PulseWire label="Running query" className="w-20" /> : null}
            <Button
              type="submit"
              size="sm"
              glow
              loading={search.running}
              disabled={!search.query.trim()}
            >
              Run query
            </Button>
          </span>
        </div>
      </form>

      <RecentQueries queries={search.recentQueries} onRun={(recent) => void search.run(recent)} />

      {search.toolsError && (
        <p
          role="status"
          className="mt-3 max-w-[66ch] border-t border-hairline pt-3 text-ui text-data-warn"
        >
          Couldn&apos;t load this collection&apos;s tools ({search.toolsError}) — queries fall back
          to the primary search tool.
        </p>
      )}

      {search.error && <SearchFailurePanel failure={search.failure} message={search.error} />}
    </Panel>
  );
}
