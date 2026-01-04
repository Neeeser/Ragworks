import { redirect } from "next/navigation";

import { isPipelineKind } from "@/components/pipelines/pipeline-kinds";
import { PipelineBuilder } from "@/components/pipelines/PipelineBuilder";

type PipelinesPageProps = {
  params: Promise<{ kind: string }>;
};

export default async function PipelinesKindPage({ params }: PipelinesPageProps) {
  const resolvedParams = await params;
  if (!isPipelineKind(resolvedParams.kind)) {
    redirect("/pipelines");
  }

  return <PipelineBuilder kind={resolvedParams.kind} />;
}
