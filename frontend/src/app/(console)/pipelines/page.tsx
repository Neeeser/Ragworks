"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  PIPELINE_KIND_STORAGE_KEY,
  PIPELINE_KINDS,
  isPipelineKind,
  pipelineKindHref,
} from "@/components/pipelines/lib/pipeline-kinds";

export default function PipelinesPage() {
  const router = useRouter();

  useEffect(() => {
    const savedKind = localStorage.getItem(PIPELINE_KIND_STORAGE_KEY);
    const nextKind = isPipelineKind(savedKind) ? savedKind : PIPELINE_KINDS[0];
    router.replace(pipelineKindHref(nextKind));
  }, [router]);

  // A redirect shim, not a load: the kind route paints the editor's own
  // skeleton, so this frame stays a single line rather than a fake layout.
  return (
    <div className="flex h-full items-center justify-center text-ui text-muted">
      Loading pipelines…
    </div>
  );
}
