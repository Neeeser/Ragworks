"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { fetchDocumentChunks } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { truncate } from "@/lib/utils";

import type { FileIngestion, FileNode } from "@/lib/types";

type FileRowDetailsProps = {
  node: FileNode;
  ingestion: FileIngestion;
  token: string;
};

/** Expanded row: how the file was chunked and stored, plus its trace links. */
export function FileRowDetails({ node, ingestion, token }: FileRowDetailsProps) {
  const router = useRouter();
  const ready = ingestion.status === "ready";
  const chunksQuery = useApiQuery(
    () => fetchDocumentChunks(token, ingestion.document_id),
    [token, ingestion.document_id, ingestion.updated_at],
    { enabled: ready },
  );

  const stats: Array<{ label: string; value: string }> = [
    { label: "Chunks", value: String(ingestion.num_chunks) },
    { label: "Tokens", value: String(ingestion.num_tokens) },
    { label: "Strategy", value: ingestion.chunk_strategy },
    { label: "Chunk size", value: String(ingestion.chunk_size) },
    { label: "Overlap", value: String(ingestion.chunk_overlap) },
    { label: "Embedding model", value: ingestion.embedding_model || "—" },
  ];

  return (
    <div className="space-y-4 border-t border-hairline bg-surface px-4 py-4 sm:pl-16">
      {ingestion.status === "failed" && (
        <p className="rounded-2xl border border-data-neg/40 bg-data-neg/10 p-3 text-sm text-body">
          {ingestion.error_message ?? "Ingestion failed."}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((item) => (
          <div key={`${node.id}-${item.label}`}>
            <dt className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              {item.label}
            </dt>
            <dd className="mt-1 truncate text-sm text-primary" title={item.value}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {ingestion.ingestion_run_id && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.push(`/traces/documents/${ingestion.document_id}`)}
        >
          View ingestion trace
        </Button>
      )}
      {ready &&
        (chunksQuery.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader className="h-4 w-4" />
            Loading chunks…
          </div>
        ) : chunksQuery.error ? (
          <p className="text-sm text-data-neg">{chunksQuery.error}</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {(chunksQuery.data?.chunks ?? []).map((chunk) => (
              <details
                key={chunk.id}
                className="rounded-2xl border border-hairline bg-canvas px-4 py-2.5"
              >
                <summary className="cursor-pointer text-sm text-body">
                  Chunk #{chunk.chunk_index} — {truncate(chunk.text, 90)}
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="whitespace-pre-wrap text-sm text-primary">{chunk.text}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      router.push(
                        `/traces/documents/${ingestion.document_id}?chunk=${encodeURIComponent(chunk.id)}`,
                      )
                    }
                  >
                    Trace this chunk
                  </Button>
                </div>
              </details>
            ))}
          </div>
        ))}
    </div>
  );
}
