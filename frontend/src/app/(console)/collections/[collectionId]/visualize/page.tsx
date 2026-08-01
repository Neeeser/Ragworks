"use client";

import { useCollection } from "@/components/collections/detail/collection-context";
import { CollectionInsights } from "@/components/collections/detail/visualize/CollectionInsights";

export default function CollectionVisualizePage() {
  const { collection, token } = useCollection();
  return <CollectionInsights collectionId={collection.id} token={token} />;
}
