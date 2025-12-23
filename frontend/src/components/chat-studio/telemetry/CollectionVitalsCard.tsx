"use client";

import type { Collection } from "@/lib/types";

interface CollectionVitalsCardProps {
  collection: Collection | null;
  documentCount: number;
}

export const CollectionVitalsCard = ({ collection, documentCount }: CollectionVitalsCardProps) => {
  if (!collection) {
    return <p className="text-sm text-slate-400">Loading collection details…</p>;
  }

  return (
    <div className="space-y-2 text-sm text-slate-300">
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
