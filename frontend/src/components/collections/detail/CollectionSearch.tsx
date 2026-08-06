"use client";

import { useRouter } from "next/navigation";

import { SearchComposer } from "@/components/collections/detail/search/SearchComposer";
import { SearchResults } from "@/components/collections/detail/search/SearchResults";
import { useCollectionSearch } from "@/components/collections/detail/search/use-collection-search";
import { PageBody } from "@/components/ui/app-shell";

type CollectionSearchProps = {
  collectionId: string;
  token: string;
};

/**
 * Run one of this collection's tools and inspect every result.
 *
 * Two cards: the composer that runs the query, and the results it produced.
 * Nothing sits between them explaining what the page does — the breadcrumb owns
 * the collection's identity and the composer explains itself.
 */
export function CollectionSearch({ collectionId, token }: CollectionSearchProps) {
  const router = useRouter();
  const search = useCollectionSearch(token, collectionId);

  // Targeting a chunk makes the debugger join retrieval with the ingestion
  // run that produced it — the whole document → chunk → index → query path.
  const openTrace = (chunkId?: string | null) => {
    if (!search.result?.query_event_id) return;
    const chunkParam = chunkId ? `?chunk=${encodeURIComponent(chunkId)}` : "";
    router.push(`/traces/queries/${search.result.query_event_id}${chunkParam}`);
  };

  return (
    <PageBody className="space-y-3">
      <SearchComposer search={search} />
      {search.result && (
        <SearchResults
          result={search.result}
          token={token}
          collectionId={collectionId}
          onTrace={openTrace}
        />
      )}
    </PageBody>
  );
}
