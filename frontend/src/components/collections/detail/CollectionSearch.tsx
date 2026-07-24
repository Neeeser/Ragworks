"use client";

import { History, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { QueryArgumentControls } from "@/components/collections/detail/search/QueryArgumentControls";
import { SearchFailurePanel } from "@/components/collections/detail/search/SearchFailurePanel";
import { SearchResultCard } from "@/components/collections/detail/search/SearchResultCard";
import { useCollectionSearch } from "@/components/collections/detail/search/use-collection-search";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { TextArea, TextInput } from "@/components/ui/field";
import { GlassCard } from "@/components/ui/panel";

import type { FormEvent } from "react";

type CollectionSearchProps = {
  collectionId: string;
  token: string;
};

/** Run one of this collection's tools and inspect every result. */
export function CollectionSearch({ collectionId, token }: CollectionSearchProps) {
  const router = useRouter();
  const search = useCollectionSearch(token, collectionId);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search.run();
  };

  // Targeting a chunk makes the debugger join retrieval with the ingestion
  // run that produced it — the whole document → chunk → index → query path.
  const openTrace = (chunkId?: string | null) => {
    if (!search.result?.query_event_id) return;
    const chunkParam = chunkId ? `?chunk=${encodeURIComponent(chunkId)}` : "";
    router.push(`/traces/queries/${search.result.query_event_id}${chunkParam}`);
  };

  const chunks = useMemo(() => search.result?.chunks ?? [], [search.result]);
  const topScore = useMemo(() => Math.max(0, ...chunks.map((chunk) => chunk.score ?? 0)), [chunks]);
  const structured = search.result?.kind === "structured";
  const outputs = useMemo(
    () => Object.entries(search.result?.outputs ?? {}),
    [search.result],
  );

  const toolOptions = useMemo(
    () =>
      search.tools.map((tool) => ({
        value: tool.id,
        label: tool.is_primary ? `${tool.name} (primary)` : tool.name,
      })),
    [search.tools],
  );

  return (
    <div className="space-y-6">
      <GlassCard className="rounded-3xl p-6">
        <form onSubmit={handleSubmit}>
          {search.tools.length > 1 && (
            <div className="mb-4 max-w-sm">
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                Tool
              </p>
              <CustomSelect
                aria-label="Tool to run"
                value={search.selectedTool?.id ?? ""}
                options={toolOptions}
                placeholder="Select a tool"
                onValueChange={search.setSelectedToolId}
              />
            </div>
          )}

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-muted"
              aria-hidden
            />
            <TextArea
              className="min-h-[96px] pl-11"
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

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
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
              <label className="flex items-center gap-2 text-sm text-body">
                <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                  Top K
                </span>
                <TextInput
                  type="number"
                  min={1}
                  max={50}
                  value={search.topK}
                  onChange={(event) => search.setTopK(Number(event.target.value))}
                  className="w-20 px-3 py-1.5 text-center"
                />
              </label>
            ) : null}
            <span className="ml-auto flex items-center gap-3">
              {search.running ? (
                <span
                  role="status"
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-cyan"
                >
                  Running query…
                </span>
              ) : null}
              <Button type="submit" loading={search.running} disabled={!search.query.trim()}>
                Run query
              </Button>
            </span>
          </div>
        </form>

        {search.recentQueries.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
            <History className="h-3.5 w-3.5 text-meta" aria-hidden />
            {search.recentQueries.map((recent) => (
              <button
                key={recent}
                type="button"
                onClick={() => void search.run(recent)}
                title={recent}
                className="max-w-56 truncate rounded-full border border-hairline px-3 py-1 text-xs text-muted transition hover:border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {recent}
              </button>
            ))}
          </div>
        )}

        {search.toolsError && (
          <p className="mt-3 text-xs text-data-warn" role="status">
            Couldn&apos;t load this collection&apos;s tools ({search.toolsError}) — queries fall
            back to the primary search tool.
          </p>
        )}

        {search.error && <SearchFailurePanel failure={search.failure} message={search.error} />}
      </GlassCard>

      {search.result && (
        <GlassCard className="rounded-3xl p-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Results</p>
            {!structured && (
              <span className="text-sm text-muted">
                {chunks.length} {chunks.length === 1 ? "match" : "matches"}
              </span>
            )}
            {search.result.query_event_id && (
              <span className="ml-auto">
                <Button variant="secondary" size="sm" onClick={() => openTrace()}>
                  Trace query
                </Button>
              </span>
            )}
          </div>

          {structured ? (
            // Structured tool results: the declared output fields ARE the
            // result. Rendered as labeled values; chunk cards don't apply.
            <dl className="mt-5 space-y-2">
              {outputs.map(([name, value]) => (
                <div
                  key={name}
                  className="flex flex-wrap items-baseline gap-3 rounded-2xl border border-hairline bg-surface px-4 py-3"
                >
                  <dt className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                    {name}
                  </dt>
                  <dd className="font-mono text-sm text-primary">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </dd>
                </div>
              ))}
              {outputs.length === 0 && (
                <p className="text-sm text-muted">The tool returned no output fields.</p>
              )}
            </dl>
          ) : (
            <>
              {outputs.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {outputs.map(([name, value]) => (
                    <span
                      key={name}
                      className="rounded-full border border-hairline bg-surface px-3 py-1 font-mono text-[11px] text-muted"
                    >
                      {name} = {String(value)}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-5 space-y-3">
                {chunks.map((chunk, index) => (
                  <SearchResultCard
                    key={`${chunk.chunk_id ?? chunk.id}-${chunk.chunk_index}-${chunk.score}`}
                    chunk={chunk}
                    rank={index + 1}
                    topScore={topScore}
                    onTrace={() => openTrace((chunk.chunk_id ?? chunk.id) as string)}
                  />
                ))}
                {chunks.length === 0 && (
                  <p className="text-sm text-muted">No matches for this query.</p>
                )}
              </div>
            </>
          )}
        </GlassCard>
      )}

      {!search.result && !search.error && (
        <p className="px-2 text-sm text-muted">
          Queries run through this collection&apos;s tools; each result links to its trace.
        </p>
      )}
    </div>
  );
}
