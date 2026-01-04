"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  PIPELINE_KIND_STORAGE_KEY,
  PIPELINE_KINDS,
  isPipelineKind,
} from "@/components/pipelines/pipeline-kinds";

export default function PipelinesPage() {
  const router = useRouter();

  useEffect(() => {
    const savedKind = localStorage.getItem(PIPELINE_KIND_STORAGE_KEY);
    const nextKind = isPipelineKind(savedKind) ? savedKind : PIPELINE_KINDS[0];
    router.replace(`/pipelines/${nextKind}`);
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      Loading pipelines…
    </div>
  );
}
