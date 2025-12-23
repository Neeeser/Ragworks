"use client";

import { ArrowRight, ChevronDown, MessageSquare, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { fetchCollections, fetchDocuments, listChatSessions } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { ChatSession, Collection, Document } from "@/lib/types";

interface CollectionSummary {
  documents: number;
  sessions: number;
  lastUpdated?: string;
}

type SummaryMap = Record<string, CollectionSummary>;

const COLLECTIONS_ROUTE = "/collections";

export default function ChatStudioLanding() {
  const router = useRouter();
  const { token } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [summaries, setSummaries] = useState<SummaryMap>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setCollections([]);
      setSummaries({});
      setLoading(false);
      return;
    }

    const authToken = token ?? "";
    let cancelled = false;

    async function hydrate() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCollections(authToken);
        if (cancelled) return;
        setCollections(data);
        const details = await Promise.all(
          data.map(async (collection) => {
            try {
              const [documents, sessions] = await Promise.all([
                fetchDocuments(collection.id, authToken).catch(() => [] as Document[]),
                listChatSessions(collection.id, authToken).catch(() => [] as ChatSession[]),
              ]);
              const sortedSessions = [...sessions].sort(
                (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
              );
              return [
                collection.id,
                {
                  documents: documents.length,
                  sessions: sessions.length,
                  lastUpdated: sortedSessions[0]?.updated_at,
                },
              ];
            } catch {
              return [collection.id, { documents: 0, sessions: 0 }];
            }
          }),
        );
        if (!cancelled) {
          setSummaries(Object.fromEntries(details));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load collections.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const toggleExpanded = (collectionId: string) => {
    setExpanded((prev) => ({ ...prev, [collectionId]: !prev[collectionId] }));
  };

  const hasCollections = collections.length > 0;
  const headline = useMemo(() => {
    if (error) return "Something went wrong";
    if (!token) return "Sign in to view your chat studio";
    if (!hasCollections) return "No collections yet";
    return "Pick a collection to launch the studio";
  }, [error, hasCollections, token]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Chat studio</p>
          <h1 className="text-3xl font-semibold text-white">
            A focused workspace for multi-turn chats.
          </h1>
          <p className="mt-2 text-sm text-slate-400">{headline}</p>
        </div>
        <Button
          variant="secondary"
          className="px-6 py-3"
          onClick={() => router.push(COLLECTIONS_ROUTE)}
        >
          Manage collections
        </Button>
      </div>

      {error && (
        <GlassCard className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </GlassCard>
      )}

      {loading ? (
        <GlassCard className="flex items-center justify-center rounded-3xl p-10">
          <Loader className="h-6 w-6" />
        </GlassCard>
      ) : !hasCollections ? (
        <GlassCard className="rounded-3xl p-8 text-sm text-slate-300">
          <p>
            You don&apos;t have any collections yet. Ingest documents on the collections page to
            unlock the chat studio.
          </p>
          <Button className="mt-4" onClick={() => router.push(COLLECTIONS_ROUTE)}>
            Create a collection
          </Button>
        </GlassCard>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {collections.map((collection) => {
            const summary = summaries[collection.id] ?? { documents: 0, sessions: 0 };
            const isExpanded = expanded[collection.id];
            return (
              <GlassCard key={collection.id} className="rounded-3xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">collection</p>
                    <h2 className="text-xl font-semibold text-white">{collection.name}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {collection.description?.slice(0, 120) || "No description yet."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(collection.id)}
                    className="rounded-full border border-white/10 p-2 text-slate-300 hover:border-white/30"
                    aria-label="Toggle collection details"
                  >
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                    />
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      label: "Documents",
                      value: summary.documents.toLocaleString(),
                    },
                    {
                      label: "Chats",
                      value: summary.sessions.toLocaleString(),
                    },
                  ].map((stat) => (
                    <div
                      key={`${collection.id}-${stat.label}`}
                      className="rounded-2xl border border-white/5 bg-white/5 p-4"
                    >
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        {stat.label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
                    </div>
                  ))}
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-3 rounded-2xl border border-white/5 bg-white/5 p-4 text-sm text-slate-300">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                      <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                      Details
                    </div>
                    <ul className="space-y-2 text-sm">
                      <li>
                        Ingestion pipeline:{" "}
                        <span className="text-white">
                          {collection.ingestion_pipeline_id ?? "Default"}
                        </span>
                      </li>
                      <li>
                        Retrieval pipeline:{" "}
                        <span className="text-white">
                          {collection.retrieval_pipeline_id ?? "Default"}
                        </span>
                      </li>
                      <li>
                        Last active:{" "}
                        <span className="text-white">
                          {summary.lastUpdated ? timeAgo(summary.lastUpdated) : "Never"}
                        </span>
                      </li>
                    </ul>
                    <div className="flex flex-wrap gap-3 pt-2">
                      <Button
                        className="flex-1 justify-between"
                        onClick={() => router.push(`/chat/${collection.id}`)}
                      >
                        Enter chat
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full justify-center"
                        onClick={() => router.push(COLLECTIONS_ROUTE)}
                      >
                        <MessageSquare className="mr-2 h-4 w-4" />
                        Manage
                      </Button>
                    </div>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
