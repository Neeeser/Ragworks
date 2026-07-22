"use client";

import { useCollection } from "@/components/collections/detail/collection-context";
import { CollectionDiagnostics } from "@/components/collections/detail/diagnostics/CollectionDiagnostics";

export default function CollectionDiagnosticsPage() {
  const { collection, token } = useCollection();
  return <CollectionDiagnostics collectionId={collection.id} token={token} />;
}
