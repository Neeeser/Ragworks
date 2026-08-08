import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  LEGACY_PIPELINE_SLUGS,
  pipelineKindFromSlug,
} from "@/components/pipelines/lib/pipeline-kinds";
import { PipelineBuilder } from "@/components/pipelines/PipelineBuilder";

type PipelinesPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Re-encode a resolved `searchParams` bag, keeping repeated keys. */
function queryString(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const entry of value) search.append(key, entry);
    else if (value !== undefined) search.append(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export default async function PipelinesKindPage({ params, searchParams }: PipelinesPageProps) {
  const { slug } = await params;

  // A route-level redirect, so it holds in both runtime modes: the app runs no
  // middleware, and the `?pipeline=` deep link has to survive the hop.
  const canonical = LEGACY_PIPELINE_SLUGS[slug];
  if (canonical) {
    redirect(`/pipelines/${canonical}${queryString(await searchParams)}`);
  }

  const kind = pipelineKindFromSlug(slug);
  if (!kind) {
    redirect("/pipelines");
  }

  // The editor reads the `?pipeline=&node=` deep link, so it needs a boundary.
  return (
    <Suspense>
      <PipelineBuilder kind={kind} />
    </Suspense>
  );
}
