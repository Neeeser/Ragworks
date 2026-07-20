"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { fetchEvalDatasetDocument } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { cn, truncate } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { EvalCollectionDocument, EvalCollectionDocumentsPage } from "@/lib/types";

interface DatasetDocumentsTableProps {
  datasetId: string;
  page: EvalCollectionDocumentsPage | null;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (value: string) => void;
  offset: number;
  pageSize: number;
  onOffset: (offset: number) => void;
}

const STATUS_TONE: Record<EvalCollectionDocument["status"], string> = {
  pending: "text-muted",
  processing: "text-accent-violet",
  ready: "text-data-pos",
  failed: "text-data-neg",
};

/**
 * The selected eval collection's documents: ingestion outcome per corpus
 * document, expandable into the stored source text, with a link to the
 * document's ingestion trace.
 */
export function DatasetDocumentsTable({
  datasetId,
  page,
  loading,
  error,
  search,
  onSearch,
  offset,
  pageSize,
  onOffset,
}: DatasetDocumentsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const total = page?.total ?? 0;
  const items = page?.items ?? [];

  return (
    <div className="mt-4">
      <TextInput
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search by document id or title"
        aria-label="Search documents"
      />
      {error && <p className="mt-3 text-sm text-data-neg">{error}</p>}
      {!error && items.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          {loading ? "Loading documents…" : "No documents match."}
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-hairline font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                <th className="w-8 py-2 pr-2 font-normal">
                  <span className="sr-only">Expand</span>
                </th>
                <th className="py-2 pr-4 font-normal">Document</th>
                <th className="py-2 pr-4 font-normal">Status</th>
                <th className="py-2 pr-4 font-normal">Chunks</th>
                <th className="py-2 font-normal">Trace</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const expanded = expandedId === item.document_id;
                return (
                  <Fragment key={item.document_id}>
                    <tr className="border-b border-hairline align-top last:border-b-0">
                      <td className="py-3 pr-2">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Collapse" : "Expand"} document ${item.external_doc_id}`}
                          className="rounded-full p-1 text-muted transition hover:bg-surface-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
                          onClick={() => setExpandedId(expanded ? null : item.document_id)}
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      </td>
                      <td className="max-w-md py-3 pr-4">
                        <p className="truncate text-body">
                          {item.title ? truncate(item.title, 90) : item.external_doc_id}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-meta">
                          {item.external_doc_id}
                        </p>
                        {item.status === "failed" && item.error_message && (
                          <p className="mt-1 text-xs text-data-neg">{item.error_message}</p>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={cn(
                            "font-mono text-[11px] uppercase tracking-[0.28em]",
                            STATUS_TONE[item.status],
                          )}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-body">{item.num_chunks}</td>
                      <td className="py-3">
                        <Link
                          href={`/traces/documents/${item.document_id}`}
                          className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent-cyan underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent-violet"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-hairline last:border-b-0">
                        <td colSpan={5} className="p-0">
                          <DocumentText
                            key={item.document_id}
                            datasetId={datasetId}
                            externalDocId={item.external_doc_id}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={total} offset={offset} pageSize={pageSize} onOffset={onOffset} />
    </div>
  );
}

/** The document's stored source text, fetched when the row expands. */
function DocumentText({ datasetId, externalDocId }: { datasetId: string; externalDocId: string }) {
  const { token } = useAuth();
  const document = useApiQuery(
    () => fetchEvalDatasetDocument(token!, datasetId, externalDocId),
    [token, datasetId, externalDocId],
    { enabled: !!token },
  );
  if (document.error) {
    return (
      <p className="px-4 py-3 text-sm text-data-neg">
        {getErrorMessage(document.error, "Could not load the document text")}
      </p>
    );
  }
  if (!document.data) {
    return <p className="px-4 py-3 text-sm text-muted">Loading text…</p>;
  }
  return (
    <pre className="m-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-hairline bg-canvas p-3 font-mono text-[11px] leading-relaxed text-body">
      {document.data.text}
    </pre>
  );
}

function Pager({
  total,
  offset,
  pageSize,
  onOffset,
}: {
  total: number;
  offset: number;
  pageSize: number;
  onOffset: (offset: number) => void;
}) {
  if (total <= pageSize) {
    return null;
  }
  const start = offset + 1;
  const end = Math.min(offset + pageSize, total);
  return (
    <div className="mt-3 flex items-center justify-between gap-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
        {start}–{end} of {total.toLocaleString()}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="px-4"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          className="px-4"
          disabled={end >= total}
          onClick={() => onOffset(offset + pageSize)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
