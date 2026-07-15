"use client";

import { History, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { SearchResultCard } from "@/components/collections/detail/search/SearchResultCard";
import { useCollectionSearch } from "@/components/collections/detail/search/use-collection-search";
import { Button } from "@/components/ui/button";
import { TextArea, TextInput } from "@/components/ui/field";
import { GlassCard } from "@/components/ui/panel";

import type { FormEvent } from "react";

type CollectionSearchProps = {
  collectionId: string;
  token: string;
};

/** Run the retrieval pipeline against this collection and inspect every match. */
export function CollectionSearch({ collectionId, token }: CollectionSearchProps) {
  const router = useRouter();
  const search = useCollectionSearch(token, collectionId);
  // Client-side floor as a fraction of the top score — raw score ranges vary
  // by retrieval strategy (cosine vs RRF vs BM25), so an absolute cut is wrong.
  const [minScorePct, setMinScorePct] = useState(0);

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

  const topScore = useMemo(
    () => Math.max(0, ...(search.result?.chunks ?? []).map((chunk) => chunk.score ?? 0)),
    [search.result],
  );
  const visibleChunks = useMemo(() => {
    const chunks = search.result?.chunks ?? [];
    if (minScorePct === 0 || topScore === 0) return chunks;
    const floor = (minScorePct / 100) * topScore;
    return chunks.filter((chunk) => (chunk.score ?? 0) >= floor);
  }, [search.result, minScorePct, topScore]);
  const hiddenCount = (search.result?.chunks?.length ?? 0) - visibleChunks.length;

  return (
    <div className="space-y-6">
      <GlassCard className="rounded-3xl p-6">
        <form onSubmit={handleSubmit}>
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
            <label className="flex items-center gap-2 text-sm text-body">
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                Min score
              </span>
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={minScorePct}
                onChange={(event) => setMinScorePct(Number(event.target.value))}
                className="w-32 accent-[var(--accent-violet)]"
              />
              <span className="w-14 font-mono text-[11px] text-muted">
                {minScorePct === 0 ? "off" : `${minScorePct}% top`}
              </span>
            </label>
            <span className="ml-auto">
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

        {search.error && (
          <div className="mt-4 rounded-2xl border border-data-neg/30 bg-data-neg/10 p-3 text-sm text-data-neg">
            {search.error}
          </div>
        )}
      </GlassCard>

      {search.result && (
        <GlassCard className="rounded-3xl p-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Results</p>
            <span className="text-sm text-muted">
              {visibleChunks.length} of {search.result.chunks?.length ?? 0} matches
              {hiddenCount > 0 && ` — ${hiddenCount} below score floor`}
            </span>
            {search.result.query_event_id && (
              <span className="ml-auto">
                <Button variant="secondary" size="sm" onClick={() => openTrace()}>
                  View retrieval trace
                </Button>
              </span>
            )}
          </div>

          <div className="mt-5 space-y-3">
            {visibleChunks.map((chunk, index) => (
              <SearchResultCard
                key={`${chunk.chunk_id ?? chunk.id}-${chunk.chunk_index}-${chunk.score}`}
                chunk={chunk}
                rank={index + 1}
                topScore={topScore}
                onTrace={() => openTrace((chunk.chunk_id ?? chunk.id) as string)}
              />
            ))}
            {visibleChunks.length === 0 && (
              <p className="text-sm text-muted">No matches above the score floor.</p>
            )}
          </div>
        </GlassCard>
      )}

      {!search.result && !search.error && (
        <p className="px-2 text-sm text-muted">
          Queries run through this collection&apos;s retrieval pipeline; each result links to its
          trace.
        </p>
      )}
    </div>
  );
}
