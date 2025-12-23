"use client";

import { Activity, Database, Layers, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { fetchCollections, fetchDocuments, fetchPipelines, listChatSessions } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { ChatSession, Collection, Document, Pipeline } from "@/lib/types";

export default function DashboardPage() {
  const { token, user } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [ingestionPipelines, setIngestionPipelines] = useState<Pipeline[]>([]);
  const [retrievalPipelines, setRetrievalPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const authToken = token ?? "";
    if (!authToken) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [cols, ingestion, retrieval] = await Promise.all([
          fetchCollections(authToken),
          fetchPipelines(authToken, "ingestion"),
          fetchPipelines(authToken, "retrieval"),
        ]);
        if (cancelled) return;
        setCollections(cols);
        setIngestionPipelines(ingestion);
        setRetrievalPipelines(retrieval);
        const docResults = await Promise.all(
          cols.map(async (collection) => {
            try {
              return await fetchDocuments(collection.id, authToken);
            } catch {
              return [];
            }
          }),
        );
        if (cancelled) return;
        const flattenedDocs = docResults.flat();
        setDocuments(flattenedDocs);

        const sessionResults = await Promise.all(
          cols.map(async (collection) => {
            try {
              return await listChatSessions(collection.id, authToken);
            } catch {
              return [];
            }
          }),
        );
        if (!cancelled) {
          setSessions(sessionResults.flat());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pipelineNameById = useMemo(() => {
    const entries = [...ingestionPipelines, ...retrievalPipelines].map((pipeline) => [
      pipeline.id,
      pipeline.name,
    ]);
    return new Map(entries);
  }, [ingestionPipelines, retrievalPipelines]);
  const defaultRetrieval = useMemo(
    () =>
      retrievalPipelines.find((pipeline) => pipeline.is_default) ?? retrievalPipelines[0] ?? null,
    [retrievalPipelines],
  );

  const getContextWindow = (pipeline: Pipeline | null) => {
    if (!pipeline) return 0;
    const node = pipeline.definition.nodes.find((item) => item.type === "chat.settings");
    const value = node?.config?.context_window;
    return typeof value === "number" ? value : 0;
  };

  const stats = useMemo(() => {
    const docCount = documents.length;
    const totalChunks = documents.reduce((sum, doc) => sum + doc.num_chunks, 0);
    const totalTokens = documents.reduce((sum, doc) => sum + doc.num_tokens, 0);
    const contextCapacity = collections.reduce((sum, col) => {
      const pipeline =
        retrievalPipelines.find((item) => item.id === col.retrieval_pipeline_id) ||
        defaultRetrieval;
      return sum + getContextWindow(pipeline);
    }, 0);
    const contextConsumed = sessions.reduce((sum, session) => sum + session.context_tokens, 0);
    const contextUtilization = contextCapacity
      ? Math.min(100, Math.round((contextConsumed / contextCapacity) * 100))
      : 0;
    const avgChunkSize =
      documents.length > 0
        ? Math.round(documents.reduce((sum, doc) => sum + doc.chunk_size, 0) / documents.length)
        : 0;

    return {
      docCount,
      totalChunks,
      totalTokens,
      contextUtilization,
      contextConsumed,
      contextCapacity,
      avgChunkSize,
    };
  }, [collections, documents, sessions, retrievalPipelines, defaultRetrieval]);

  const recentDocuments = useMemo(
    () =>
      [...documents]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5),
    [documents],
  );

  const activeCollections = collections.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Dashboard</p>
          <h1 className="text-3xl font-semibold text-white">
            Hello {user?.full_name ?? user?.email}, here&apos;s your telemetry.
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/collections">
            <Button variant="secondary" className="px-6 py-3">
              Manage collections
            </Button>
          </Link>
          <Link href="/chat">
            <Button className="px-6 py-3">Go to chat studio</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <GlassCard className="flex items-center justify-center rounded-3xl p-10">
          <Loader className="h-6 w-6" />
        </GlassCard>
      ) : error ? (
        <GlassCard className="rounded-3xl p-8 text-sm text-rose-200">{error}</GlassCard>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {[
              {
                label: "Collections live",
                value: collections.length,
                icon: Layers,
                subtext: `${stats.totalChunks} chunks indexed`,
              },
              {
                label: "Documents ingested",
                value: stats.docCount,
                icon: Upload,
                subtext: `${stats.totalTokens.toLocaleString()} tokens parsed`,
              },
              {
                label: "Chat sessions",
                value: sessions.length,
                icon: Activity,
                subtext: `${stats.contextUtilization}% context utilization`,
              },
            ].map((card) => (
              <GlassCard key={card.label} className="rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <card.icon className="h-5 w-5 text-violet-300" />
                  <span className="text-sm text-slate-400">{card.label}</span>
                </div>
                <p className="mt-4 text-4xl font-semibold">{card.value}</p>
                <p className="text-sm text-slate-400">{card.subtext}</p>
              </GlassCard>
            ))}
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <GlassCard className="rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">context</p>
                  <h2 className="text-2xl font-semibold text-white">Model utilization</h2>
                </div>
                <div className="text-right text-sm text-slate-400">
                  <p>{stats.contextConsumed.toLocaleString()} tokens consumed</p>
                  <p>{stats.contextCapacity.toLocaleString()} reserved</p>
                </div>
              </div>
              <div className="mt-8 h-3 w-full rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all"
                  style={{ width: `${stats.contextUtilization}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-slate-400">
                Average chunk size {stats.avgChunkSize} tokens
              </p>
            </GlassCard>

            <GlassCard className="rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">pipeline</p>
                  <h2 className="text-2xl font-semibold text-white">Ingestion trace</h2>
                </div>
                <Database className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="mt-6 space-y-4">
                {[
                  {
                    label: "Parse",
                    status: "Healthy",
                    detail: "Uploads flowing",
                    active: true,
                  },
                  {
                    label: "Chunk",
                    status: `${stats.avgChunkSize} avg tokens`,
                    detail: "Auto tuned by embedding context",
                    active: true,
                  },
                  {
                    label: "Embed",
                    status: "OpenRouter",
                    detail: "Stored locally + Pinecone",
                    active: collections.length > 0,
                  },
                  {
                    label: "Chat",
                    status: `${sessions.length} sessions`,
                    detail: "Tool traces captured",
                    active: sessions.length > 0,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-2xl border border-white/5 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className="text-xs text-slate-400">{item.detail}</p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-xs",
                        item.active
                          ? "bg-green-500/20 text-green-200"
                          : "bg-slate-700 text-slate-300",
                      )}
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <GlassCard className="rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">documents</p>
                  <h2 className="text-2xl font-semibold text-white">Recent ingest history</h2>
                </div>
                <Link href="/collections" className="text-sm text-violet-300 hover:text-white">
                  View collections
                </Link>
              </div>

              <div className="mt-6 space-y-4">
                {recentDocuments.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No documents yet. Upload your first source from the collections page.
                  </p>
                ) : (
                  recentDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">{doc.name}</p>
                        <p className="text-xs text-slate-400">
                          {doc.status.toUpperCase()} • {doc.num_chunks} chunks •{" "}
                          {timeAgo(doc.created_at)}
                        </p>
                      </div>
                      <span className="text-xs text-slate-300">
                        {doc.chunk_strategy} • {doc.chunk_size} tokens
                      </span>
                    </div>
                  ))
                )}
              </div>
            </GlassCard>

            <GlassCard className="rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-400">collections</p>
                  <h2 className="text-2xl font-semibold text-white">Active workspaces</h2>
                </div>
                <Sparkles className="h-5 w-5 text-violet-300" />
              </div>
              <div className="mt-6 space-y-4">
                {activeCollections.length === 0 ? (
                  <p className="text-sm text-slate-400">Create your first collection to begin.</p>
                ) : (
                  activeCollections.map((collection) => (
                    <div
                      key={collection.id}
                      className="rounded-2xl border border-white/5 bg-white/5 p-4 text-sm"
                    >
                      <p className="text-base font-semibold text-white">{collection.name}</p>
                      <p className="text-xs text-slate-400">{collection.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                        <span className="rounded-full bg-white/10 px-2 py-1">
                          {pipelineNameById.get(collection.ingestion_pipeline_id ?? "") ??
                            "Ingestion pipeline"}
                        </span>
                        <span className="rounded-full bg-white/10 px-2 py-1">
                          {pipelineNameById.get(collection.retrieval_pipeline_id ?? "") ??
                            "Retrieval pipeline"}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </GlassCard>
          </section>
        </>
      )}
    </div>
  );
}
