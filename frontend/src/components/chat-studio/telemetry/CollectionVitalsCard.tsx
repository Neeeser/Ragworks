"use client";

import { Readout } from "@/components/ui/readout";

import type { Collection } from "@/lib/types";

interface CollectionVitalsCardProps {
  collection: Collection | null;
  collectionCount: number;
  documentCount: number;
}

/** What the enabled collection's tools will actually run against. */
export const CollectionVitalsCard = ({
  collection,
  collectionCount,
  documentCount,
}: CollectionVitalsCardProps) => {
  if (!collection) {
    return (
      <p className="text-ui text-muted">
        {collectionCount > 0 ? "Loading collection details…" : "No collection tools selected."}
      </p>
    );
  }

  const searchPipeline = collection.tools.find((tool) => tool.is_primary)?.pipeline_id ?? "Default";

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {collectionCount > 1 && <Readout label="Tools enabled">{collectionCount}</Readout>}
      <Readout label="Documents">{documentCount}</Readout>
      <Readout label="Ingestion pipeline" className="min-w-0">
        {collection.ingest_pipeline_id ?? "Default"}
      </Readout>
      <Readout label="Search pipeline" className="min-w-0">
        {searchPipeline}
      </Readout>
    </div>
  );
};
