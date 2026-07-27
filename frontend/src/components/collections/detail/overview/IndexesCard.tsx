"use client";

import { IndexBackendIcon } from "@/components/pipelines/icons/IndexBackendIcon";
import { Panel } from "@/components/ui/panel";
import { fetchCollectionIndexes } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { Collection } from "@/lib/types";

type IndexesCardProps = {
  collection: Collection;
  token: string;
};

/**
 * Where this collection's data lives.
 *
 * A statement, never a control: a pipeline names the index it reads and
 * writes, so the choice belongs to the pipeline and the Pipelines card links
 * to it. The card exists because a collection still has to be able to answer
 * the question, and only it knows which pipelines are bound to it.
 */
export function IndexesCard({ collection, token }: IndexesCardProps) {
  const indexes = useApiQuery(
    () => fetchCollectionIndexes(token, collection.id),
    [token, collection.id],
  );
  const targets = indexes.data?.targets ?? [];

  return (
    <Panel className="p-3">
      <h2 className="text-ui font-medium text-primary">Indexes</h2>
      {indexes.error ? (
        <p className="mt-3 text-ui text-data-neg">{indexes.error}</p>
      ) : targets.length === 0 ? (
        <p className="mt-3 text-ui text-muted">
          {indexes.loading ? "Loading…" : "The bound pipelines name no index."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {targets.map((target) => (
            <li
              key={`${target.backend}:${target.name}:${target.vector_type}`}
              className="flex flex-wrap items-baseline justify-between gap-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <IndexBackendIcon backend={target.backend} />
                <div className="min-w-0">
                  <p className="truncate font-mono text-ui text-primary">{target.name}</p>
                  <p className="truncate text-instrument text-meta">
                    {target.pipelines.join(", ")}
                  </p>
                </div>
              </div>
              <p className="font-mono text-instrument tabular-nums text-meta">
                {target.vector_type === "sparse"
                  ? "BM25"
                  : target.dimension
                    ? `${target.dimension}d`
                    : "dense"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
