import { redirect } from "next/navigation";
import { Suspense } from "react";

import { isPipelineKind } from "@/components/pipelines/lib/pipeline-kinds";
import { PipelineBuilder } from "@/components/pipelines/PipelineBuilder";

type PipelinesPageProps = {
  params: Promise<{ kind: string }>;
};

export default async function PipelinesKindPage({ params }: PipelinesPageProps) {
  const resolvedParams = await params;
  if (!isPipelineKind(resolvedParams.kind)) {
    redirect("/pipelines");
  }

  // The editor reads the `?pipeline=&node=` deep link, so it needs a boundary.
  return (
    <Suspense>
      <PipelineBuilder kind={resolvedParams.kind} />
    </Suspense>
  );
}
