"use client";

import type { Collection } from "@/lib/types";

interface CollectionVitalsCardProps {
  collection: Collection | null;
  collectionCount: number;
  documentCount: number;
}

export const CollectionVitalsCard = ({
  collection,
  collectionCount,
  documentCount,
}: CollectionVitalsCardProps) => {
  if (!collection) {
    return (
      <p className="text-sm text-slate-400">
        {collectionCount > 0 ? "Loading collection details…" : "No collection tools selected."}
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm text-slate-300">
      {collectionCount > 1 && (
        <p>
          Tools enabled: <span className="text-white">{collectionCount}</span> (showing primary)
        </p>
      )}
      <p>
        Documents: <span className="text-white">{documentCount}</span>
      </p>
      <p>
        Ingestion pipeline:{" "}
        <span className="text-white">{collection.ingestion_pipeline_id ?? "Default"}</span>
      </p>
      <p>
        Retrieval pipeline:{" "}
        <span className="text-white">{collection.retrieval_pipeline_id ?? "Default"}</span>
      </p>
    </div>
  );
};
