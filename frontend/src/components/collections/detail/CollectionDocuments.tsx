"use client";

import { ChevronDown, ChevronRight, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PipelineTraceViewer } from "@/components/traces/PipelineTraceViewer";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { fetchDocumentChunks, fetchDocuments, fetchDocumentTrace, uploadDocument } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn, prettyJson, truncate } from "@/lib/utils";

import type { Chunk, Document, PipelineTraceResponse } from "@/lib/types";
import type { ChangeEvent } from "react";

type CollectionDocumentsProps = {
  collectionId: string;
  token: string;
};

export function CollectionDocuments({ collectionId, token }: CollectionDocumentsProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [chunksByDocument, setChunksByDocument] = useState<Record<string, Chunk[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [traceByDocument, setTraceByDocument] = useState<Record<string, PipelineTraceResponse>>({});
  const [traceLoading, setTraceLoading] = useState<Record<string, boolean>>({});
  const [activeTraceDocumentId, setActiveTraceDocumentId] = useState<string | null>(null);
  const [activeTraceChunkId, setActiveTraceChunkId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeTrace = activeTraceDocumentId ? traceByDocument[activeTraceDocumentId] : null;

  useEffect(() => {
    let cancelled = false;

    async function loadDocuments() {
      setLoading(true);
      setMessage(null);
      try {
        const docs = await fetchDocuments(token, collectionId);
        if (!cancelled) {
          setDocuments(docs);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(getErrorMessage(error, "Unable to load documents."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (collectionId && token) {
      loadDocuments();
    }

    return () => {
      cancelled = true;
    };
  }, [collectionId, token]);

  const loadChunks = async (documentId: string) => {
    setWorking((prev) => ({ ...prev, [documentId]: true }));
    try {
      const payload = await fetchDocumentChunks(token, documentId);
      setChunksByDocument((prev) => ({ ...prev, [documentId]: payload.chunks }));
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to load chunks."));
    } finally {
      setWorking((prev) => ({ ...prev, [documentId]: false }));
    }
  };

  const toggleDocument = (doc: Document) => {
    const willOpen = !expanded[doc.id];
    setExpanded((prev) => ({ ...prev, [doc.id]: willOpen }));
    if (willOpen && !chunksByDocument[doc.id]) {
      loadChunks(doc.id);
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      await uploadDocument(token, collectionId, file);
      const docs = await fetchDocuments(token, collectionId);
      setDocuments(docs);
      setMessage(`Uploaded ${file.name}. Chunking in progress.`);
    } catch (error) {
      setMessage(getErrorMessage(error, "Upload failed."));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const loadTrace = async (documentId: string, chunkId?: string | null) => {
    setTraceLoading((prev) => ({ ...prev, [documentId]: true }));
    setMessage(null);
    try {
      const trace = await fetchDocumentTrace(token, documentId);
      setTraceByDocument((prev) => ({ ...prev, [documentId]: trace }));
      setActiveTraceDocumentId(documentId);
      setActiveTraceChunkId(chunkId ?? null);
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to load trace."));
    } finally {
      setTraceLoading((prev) => ({ ...prev, [documentId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <GlassCard className="rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Documents</p>
            <h2 className="text-2xl font-semibold">Sources and chunk lineage</h2>
            <p className="text-sm text-slate-400">
              Expand a document to inspect every chunk and its metadata.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            loading={uploading}
            className="flex items-center gap-2"
          >
            <UploadCloud className="h-4 w-4" />
            Upload document
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
        </div>
        {message && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
            {message}
          </div>
        )}
      </GlassCard>

      {loading ? (
        <GlassCard className="flex items-center justify-center rounded-3xl p-10">
          <Loader className="h-6 w-6" />
        </GlassCard>
      ) : documents.length === 0 ? (
        <GlassCard className="rounded-3xl p-6 text-sm text-slate-400">
          No documents yet. Upload a file to start chunking.
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => {
            const isOpen = expanded[doc.id];
            const chunks = chunksByDocument[doc.id] ?? [];
            const isLoadingChunks = working[doc.id];
            const trace = traceByDocument[doc.id];
            const isTraceLoading = traceLoading[doc.id];
            return (
              <GlassCard key={doc.id} className="rounded-3xl border border-white/10 p-4">
                <button
                  type="button"
                  onClick={() => toggleDocument(doc)}
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  <div>
                    <p className="text-base font-semibold text-white">{doc.name}</p>
                    <p className="text-xs text-slate-400">
                      {doc.status.toUpperCase()} | {doc.num_chunks} chunks | {doc.num_tokens} tokens
                    </p>
                  </div>
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-slate-300 transition",
                      isOpen && "border-violet-400 text-violet-300",
                    )}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        { label: "Chunk size", value: doc.chunk_size },
                        { label: "Chunk overlap", value: doc.chunk_overlap },
                        { label: "Chunk strategy", value: doc.chunk_strategy },
                      ].map((item) => (
                        <div
                          key={`${doc.id}-${item.label}`}
                          className="rounded-2xl border border-white/5 bg-white/5 p-3 text-sm"
                        >
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                            {item.label}
                          </p>
                          <p className="mt-2 text-sm text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={isTraceLoading}
                        onClick={() => loadTrace(doc.id)}
                      >
                        {trace ? "Refresh trace" : "View ingestion trace"}
                      </Button>
                      {doc.ingestion_run_id && (
                        <p className="text-xs text-slate-400">Trace run: {doc.ingestion_run_id}</p>
                      )}
                    </div>

                    {isLoadingChunks ? (
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Loader className="h-4 w-4" />
                        Loading chunks...
                      </div>
                    ) : chunks.length === 0 ? (
                      <p className="text-sm text-slate-400">No chunks ready yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {chunks.map((chunk) => (
                          <details
                            key={chunk.id}
                            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
                          >
                            <summary className="cursor-pointer text-sm text-slate-200">
                              Chunk #{chunk.chunk_index} - {truncate(chunk.text, 90)}
                            </summary>
                            <div className="mt-3 space-y-3 text-sm text-slate-300">
                              <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                                  Full text
                                </p>
                                <p className="mt-2 whitespace-pre-wrap text-slate-100">
                                  {chunk.text}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                                  Metadata
                                </p>
                                <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-xs text-slate-100">
                                  {prettyJson(chunk.metadata)}
                                </pre>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => loadTrace(doc.id, chunk.id)}
                              >
                                Trace this chunk
                              </Button>
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
      <PipelineTraceViewer
        key={activeTrace?.run.id ?? activeTraceDocumentId ?? "trace"}
        trace={activeTrace}
        isOpen={Boolean(activeTraceDocumentId)}
        onClose={() => {
          setActiveTraceDocumentId(null);
          setActiveTraceChunkId(null);
        }}
        highlightChunkId={activeTraceChunkId}
      />
    </div>
  );
}
