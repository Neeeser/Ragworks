"use client";

import { useState } from "react";

import { indexOptionLabel } from "@/components/collections/detail/overview/BindingIndexFields";
import { CollectionIndexesDialog } from "@/components/collections/detail/overview/CollectionIndexesDialog";
import { useIndexes } from "@/components/indexes/use-indexes";
import { IndexBackendIcon } from "@/components/pipelines/icons/IndexBackendIcon";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel } from "@/components/ui/panel";
import { fetchCollectionIndexes } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type { Collection } from "@/lib/types";

type IndexesCardProps = {
  collection: Collection;
  token: string;
  onIndexesChanged: () => void | Promise<void>;
};

/**
 * Where this collection's data lives.
 *
 * A pipeline names the index it writes to, so for most collections this is a
 * statement, not a control — the choice belongs to the pipeline, and the
 * Pipelines card links to it. A pipeline whose author deliberately exposed an
 * index slot is the exception: that slot is a question only a collection can
 * answer, so it gets a control here and nothing else does.
 */
export function IndexesCard({ collection, token, onIndexesChanged }: IndexesCardProps) {
  const indexes = useApiQuery(
    () => fetchCollectionIndexes(token, collection.id),
    [token, collection.id],
  );
  const { registeredIndexes, refreshIndexes } = useIndexes(token);
  const [editing, setEditing] = useState(false);

  const slots = indexes.data?.slots ?? [];
  const targets = indexes.data?.targets ?? [];
  const empty = slots.length === 0 && targets.length === 0;

  return (
    <Panel className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ui font-medium text-primary">Indexes</h2>
        {slots.length > 0 && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>

      {indexes.error ? (
        <p className="mt-3 text-ui text-data-neg">{indexes.error}</p>
      ) : empty ? (
        <p className="mt-3 text-ui text-muted">
          {indexes.loading ? "Loading…" : "The bound pipelines name no index."}
        </p>
      ) : null}

      {targets.length > 0 ? (
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
      ) : null}

      {slots.length > 0 ? (
        <div className={targets.length > 0 ? "mt-4 border-t border-hairline pt-3" : "mt-3"}>
          <InstrumentLabel>Set per collection</InstrumentLabel>
          <ul className="mt-2 space-y-2">
            {slots.map((slot) => (
              <li key={slot.name} className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-ui text-body">{slot.description || slot.name}</p>
                  <p className="text-instrument text-meta">
                    {slot.name} · {slot.pipelines.join(", ")}
                  </p>
                </div>
                <p className="font-mono text-instrument tabular-nums text-primary">
                  {slot.current ? indexOptionLabel(slot.current) : "not set"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <CollectionIndexesDialog
          collectionId={collection.id}
          token={token}
          slots={slots}
          indexes={registeredIndexes}
          onSaved={() => {
            setEditing(false);
            void indexes.reload();
            void onIndexesChanged();
          }}
          onIndexCreated={refreshIndexes}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Panel>
  );
}
