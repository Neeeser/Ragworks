"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { FilesBrowser } from "@/components/files/FilesBrowser";
import { Loader } from "@/components/ui/loader";
import { GlassCard } from "@/components/ui/panel";
import { fetchCollection } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

type FilesPageProps = {
  collectionId: string;
  pathSegments: string[];
};

/** Page shell: auth + collection lookup around the file browser. */
export function FilesPage({ collectionId, pathSegments }: FilesPageProps) {
  const router = useRouter();
  const { token } = useAuth();
  const collection = useApiQuery(
    () => fetchCollection(token ?? "", collectionId),
    [token, collectionId],
    { enabled: Boolean(token) },
  );

  if (!token || (collection.loading && !collection.data)) {
    return (
      <GlassCard className="flex items-center justify-center rounded-3xl p-10">
        <Loader className="h-6 w-6" />
      </GlassCard>
    );
  }

  if (collection.error || !collection.data) {
    return (
      <GlassCard className="rounded-3xl border border-hairline p-6 text-sm text-body">
        {collection.error ?? "Collection not available."}
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => router.push(`/collections/${collectionId}`)}
        className="flex items-center gap-2 rounded-2xl border border-hairline px-3 py-2 text-sm text-body transition hover:border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {collection.data.name}
      </button>
      <FilesBrowser
        token={token}
        collectionId={collectionId}
        collectionName={collection.data.name}
        pathSegments={pathSegments}
      />
    </div>
  );
}
