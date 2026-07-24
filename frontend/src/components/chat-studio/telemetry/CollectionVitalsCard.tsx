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
      <p className="text-sm text-muted">
        {collectionCount > 0 ? "Loading collection details…" : "No collection tools selected."}
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm text-body">
      {collectionCount > 1 && (
        <p>
          Tools enabled: <span className="text-primary">{collectionCount}</span> (showing primary)
        </p>
      )}
      <p>
        Documents: <span className="text-primary">{documentCount}</span>
      </p>
      <p>
        Ingestion pipeline:{" "}
        <span className="text-primary">{collection.ingest_pipeline_id ?? "Default"}</span>
      </p>
      <p>
        Search tool pipeline:{" "}
        <span className="text-primary">
          {collection.tools.find((tool) => tool.is_primary)?.pipeline_id ?? "Default"}
        </span>
      </p>
    </div>
  );
};
