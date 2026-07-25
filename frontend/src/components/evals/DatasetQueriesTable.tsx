"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

import {
  DATASET_QUERIES_PAGE_SIZE,
  useDatasetQueries,
} from "@/components/evals/hooks/use-dataset-queries";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextArea } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { getErrorMessage } from "@/lib/errors";

import type { EvalDatasetQuery, EvalQuestionType } from "@/lib/types";

const TYPE_LABEL: Record<EvalQuestionType, string> = {
  single_fact: "fact",
  paraphrased: "paraphrased",
  multi_detail: "multi-detail",
};

/**
 * The dataset's queries with their gold documents and (for synthetic
 * datasets) generation metadata. Editing a query's text keeps its gold
 * labels; deleting removes its relevance judgments with it.
 */
export function DatasetQueriesTable({ datasetId }: { datasetId: string }) {
  const { page, offset, setOffset, actionError, saveQueryText, removeQuery } =
    useDatasetQueries(datasetId);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EvalDatasetQuery | null>(null);

  const total = page.data?.total ?? 0;
  const items = page.data?.items ?? [];

  const save = async () => {
    if (!editing || editing.text.trim() === "") return;
    const ok = await saveQueryText(editing.id, editing.text.trim());
    if (ok) setEditing(null);
  };

  return (
    <Panel>
      <PanelHeader
        title="Queries"
        end={
          <span className="font-mono text-instrument tabular-nums text-meta">
            {total.toLocaleString()} total
          </span>
        }
      />

      {actionError && (
        <p role="alert" className="border-b border-hairline px-3 py-2 text-ui text-data-neg">
          {actionError}
        </p>
      )}

      {page.error ? (
        <p className="p-3 text-ui text-data-neg">
          {getErrorMessage(page.error, "Could not load queries")}
        </p>
      ) : page.loading && items.length === 0 ? (
        <div aria-busy>
          {[0, 1, 2].map((row) => (
            <div key={row} className="border-b border-hairline px-3 py-3 last:border-b-0">
              <Skeleton className="h-2 max-w-96" />
              <Skeleton className="mt-2 h-2 max-w-48" />
            </div>
          ))}
          <span className="sr-only">Loading queries</span>
        </div>
      ) : items.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">No queries in this dataset.</p>
      ) : (
        <ul>
          {items.map((query) => (
            <li key={query.id} className="border-b border-hairline px-3 py-3 last:border-b-0">
              {editing?.id === query.id ? (
                <div className="space-y-2">
                  <TextArea
                    rows={2}
                    value={editing.text}
                    aria-label="Query text"
                    onChange={(event) => setEditing({ id: query.id, text: event.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={save}>
                      <Check className="h-3.5 w-3.5" aria-hidden /> Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                      <X className="h-3.5 w-3.5" aria-hidden /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-ui text-primary">{query.text}</p>
                    {/* One meta line: question shape, the documents judged
                        relevant to it, and the grader's scores. */}
                    <p className="mt-1 text-instrument text-muted">
                      {query.question_type && `${TYPE_LABEL[query.question_type]} · `}
                      {query.gold.length > 0 &&
                        `gold: ${query.gold
                          .map((entry) => entry.title ?? entry.external_doc_id)
                          .join(", ")}`}
                      {query.scores &&
                        ` · scores ${["groundedness", "standalone", "realism"]
                          .map((key) => query.scores?.[key])
                          .filter((value) => value !== undefined)
                          .join("/")}`}
                    </p>
                    {query.quote && (
                      <Tooltip content={query.quote} triggerClassName="mt-1 max-w-full">
                        <span className="block truncate text-instrument text-meta">
                          “{query.quote}”
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip content="Edit query">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit query ${query.external_query_id}`}
                        onClick={() => setEditing({ id: query.id, text: query.text })}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Delete query" side="left">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete query ${query.external_query_id}`}
                        className="hover:text-data-neg"
                        onClick={() => setPendingDelete(query)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {total > DATASET_QUERIES_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - DATASET_QUERIES_PAGE_SIZE))}
          >
            Previous
          </Button>
          <InstrumentLabel className="font-mono tabular-nums">
            {offset + 1}–{Math.min(offset + DATASET_QUERIES_PAGE_SIZE, total)} of{" "}
            {total.toLocaleString()}
          </InstrumentLabel>
          <Button
            size="sm"
            variant="secondary"
            disabled={offset + DATASET_QUERIES_PAGE_SIZE >= total}
            onClick={() => setOffset(offset + DATASET_QUERIES_PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete query"
        description={`Delete "${pendingDelete?.text ?? ""}" and its relevance judgments.`}
        confirmLabel="Delete query"
        confirmVariant="danger"
        onConfirm={async () => {
          if (pendingDelete) await removeQuery(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Panel>
  );
}
