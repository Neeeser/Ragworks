"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { PipelineTraceViewer } from "@/components/traces/PipelineTraceViewer";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";
import { fetchQueryEventEndToEndTrace, fetchQueryEventTrace, runCollectionQuery } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { truncate } from "@/lib/utils";

import type { CollectionQueryResult, PipelineTraceResponse } from "@/lib/types";
import type { FormEvent } from "react";

type CollectionSearchProps = {
  collectionId: string;
  token: string;
};

export function CollectionSearch({ collectionId, token }: CollectionSearchProps) {
  const [query, setQuery] = useState("What does this collection contain?");
  const [topK, setTopK] = useState(4);
  const [queryResult, setQueryResult] = useState<CollectionQueryResult | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [trace, setTrace] = useState<PipelineTraceResponse | null>(null);
  const [originTrace, setOriginTrace] = useState<PipelineTraceResponse | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceChunkId, setTraceChunkId] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);

  const handleQuery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;
    setWorking(true);
    setMessage(null);
    try {
      const result = await runCollectionQuery(token, collectionId, { query, top_k: topK });
      setQueryResult(result);
      setTrace(null);
      setOriginTrace(null);
      setTraceChunkId(null);
      setTraceOpen(false);
    } catch (error) {
      setMessage(getErrorMessage(error, "Query failed."));
    } finally {
      setWorking(false);
    }
  };

  const loadTrace = async (chunkId?: string | null) => {
    if (!queryResult?.query_event_id) {
      setMessage("Trace is not available for this query.");
      return;
    }
    setTraceLoading(true);
    setMessage(null);
    try {
      if (chunkId) {
        // Tracing a specific chunk: join retrieval with the ingestion run that
        // produced it, so the whole document → chunk → index → retrieval path
        // plays as one flow.
        const payload = await fetchQueryEventEndToEndTrace(
          token,
          queryResult.query_event_id,
          chunkId,
        );
        setTrace(payload.retrieval);
        setOriginTrace(payload.origin?.trace ?? null);
      } else {
        const payload = await fetchQueryEventTrace(token, queryResult.query_event_id);
        setTrace(payload);
        setOriginTrace(null);
      }
      setTraceChunkId(chunkId ?? null);
      setTraceOpen(true);
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to load trace."));
    } finally {
      setTraceLoading(false);
    }
  };

  const topScores = useMemo(() => {
    if (!queryResult?.chunks?.length) return { max: 0 };
    const max = Math.max(...queryResult.chunks.map((chunk) => chunk.score ?? 0));
    return { max };
  }, [queryResult]);

  return (
    <div className="space-y-6">
      <GlassCard className="rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Retriever</p>
            <h2 className="text-2xl font-semibold">Transparent similarity search</h2>
            <p className="text-sm text-slate-400">
              Run the retrieval pipeline against this collection.
            </p>
          </div>
          <Search className="h-5 w-5 text-violet-300" />
        </div>
        {message && (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
            {message}
          </div>
        )}
        <form className="mt-4 space-y-4" onSubmit={handleQuery}>
          <textarea
            className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <label htmlFor="topk" className="text-xs uppercase tracking-[0.3em]">
              Top K
            </label>
            <input
              id="topk"
              type="number"
              min={1}
              max={12}
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value))}
              className="w-20 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-center text-white outline-none focus:border-violet-400"
            />
            <Button type="submit" loading={working}>
              Run query
            </Button>
          </div>
        </form>
      </GlassCard>

      <GlassCard className="rounded-3xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Results</p>
            <h2 className="text-2xl font-semibold">Retrieved chunks</h2>
          </div>
          <span className="text-sm text-slate-400">{queryResult?.chunks?.length ?? 0} matches</span>
        </div>

        <div className="mt-6 space-y-4">
          {!queryResult && <p className="text-sm text-slate-400">No queries yet.</p>}
          {queryResult && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <Button
                variant="secondary"
                size="sm"
                loading={traceLoading}
                onClick={() => loadTrace()}
              >
                {trace ? "Refresh trace" : "View retrieval trace"}
              </Button>
              {queryResult.query_event_id && (
                <span className="text-xs text-slate-400">
                  Query event: {queryResult.query_event_id}
                </span>
              )}
            </div>
          )}
          {queryResult?.chunks?.map((chunk) => (
            <div
              key={`${chunk.chunk_id ?? chunk.id}-${chunk.chunk_index}-${chunk.score}`}
              className="rounded-2xl border border-white/5 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  score {(chunk.score ?? 0).toFixed(3)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => loadTrace((chunk.chunk_id ?? chunk.id) as string)}
                >
                  Trace result
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="h-2 w-32 rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                    style={{
                      width: `${topScores.max ? ((chunk.score ?? 0) / topScores.max) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-100">{truncate(chunk.text ?? "", 320)}</p>
              {chunk.metadata && (
                <p className="mt-2 text-xs text-slate-400">
                  {Object.entries(chunk.metadata)
                    .slice(0, 3)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(" | ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </GlassCard>
      <PipelineTraceViewer
        key={`${trace?.run.id ?? "trace"}-${originTrace?.run.id ?? "solo"}`}
        trace={trace}
        originTrace={originTrace}
        isOpen={traceOpen}
        onClose={() => setTraceOpen(false)}
        highlightChunkId={traceChunkId}
      />
    </div>
  );
}
