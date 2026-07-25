"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

import { documentStatus } from "@/components/evals/lib/status";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { fetchEvalDatasetDocument } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useApiQuery } from "@/lib/use-api-query";
import { truncate } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import type { EvalCollectionDocumentsPage } from "@/lib/types";

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
    <div className="flex min-w-0 flex-col">
      <div className="border-b border-hairline p-2">
        <TextInput
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search by document id or title"
          aria-label="Search documents"
        />
      </div>

      {error && <p className="p-3 text-ui text-data-neg">{error}</p>}

      {!error && items.length === 0 && loading && (
        <div aria-busy>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 border-b border-hairline px-3 py-3">
              <Skeleton className="h-3.5 w-3.5" />
              <Skeleton className="h-2 max-w-48 flex-1" />
              <Skeleton className="h-2 w-24" />
              <Skeleton className="h-2 w-12" />
            </div>
          ))}
          <span className="sr-only">Loading documents</span>
        </div>
      )}

      {!error && items.length === 0 && !loading && (
        <p className="p-8 text-center text-ui text-muted">No documents match.</p>
      )}

      {items.length > 0 && (
        // Wide content scrolls inside its own region; the page never does.
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-hairline">
                <th scope="col" className="w-8 py-2 pl-3 pr-1">
                  <span className="sr-only">Expand</span>
                </th>
                <th scope="col" className="py-2 pr-3">
                  <InstrumentLabel>Document</InstrumentLabel>
                </th>
                <th scope="col" className="w-28 py-2 pr-3">
                  <InstrumentLabel>Status</InstrumentLabel>
                </th>
                <th scope="col" className="w-16 py-2 pr-3 text-right">
                  <InstrumentLabel>Chunks</InstrumentLabel>
                </th>
                <th scope="col" className="w-20 py-2 pr-3 text-right">
                  <InstrumentLabel>Trace</InstrumentLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const expanded = expandedId === item.document_id;
                const state = documentStatus(item.status);
                return (
                  <Fragment key={item.document_id}>
                    <tr className="border-b border-hairline align-top last:border-b-0">
                      <td className="py-2 pl-3 pr-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Collapse" : "Expand"} document ${item.external_doc_id}`}
                          onClick={() => setExpandedId(expanded ? null : item.document_id)}
                        >
                          {expanded ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </Button>
                      </td>
                      <td className="max-w-md py-3 pr-3">
                        <p className="truncate text-ui text-body">
                          {item.title ? truncate(item.title, 90) : item.external_doc_id}
                        </p>
                        {/* The corpus id is a literal the dataset ships — mono,
                            verbatim, no case change. */}
                        <p className="mt-0.5 truncate font-mono text-instrument text-meta">
                          {item.external_doc_id}
                        </p>
                        {item.status === "failed" && item.error_message && (
                          <p className="mt-1 text-instrument text-data-neg">{item.error_message}</p>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <StatusDot tone={state.tone} label={state.label} />
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-ui tabular-nums text-body">
                        {item.num_chunks.toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <ButtonLink href={`/traces/documents/${item.document_id}`} variant="ghost">
                          Open
                        </ButtonLink>
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
      <p className="border-t border-hairline bg-surface px-3 py-2 text-ui text-data-neg">
        {getErrorMessage(document.error, "Could not load the document text")}
      </p>
    );
  }
  if (!document.data) {
    return (
      <div className="space-y-2 border-t border-hairline bg-surface px-3 py-3" aria-busy>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-2 w-5/6" />
        <Skeleton className="h-2 w-4/6" />
        <span className="sr-only">Loading document text</span>
      </div>
    );
  }
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-hairline bg-surface px-3 py-3 font-mono text-instrument leading-relaxed text-body">
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
    <div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2">
      <InstrumentLabel className="font-mono tabular-nums">
        {start}–{end} of {total.toLocaleString()}
      </InstrumentLabel>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={end >= total}
          onClick={() => onOffset(offset + pageSize)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
