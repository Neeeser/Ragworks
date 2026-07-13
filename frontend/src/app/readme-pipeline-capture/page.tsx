import { notFound } from "next/navigation";

import { ReadmePipelineCapture } from "@/components/readme/ReadmePipelineCapture";

import type { PipelineKind } from "@/lib/types";

type CapturePageProps = {
  searchParams: Promise<{ kind?: string }>;
};

export default async function CapturePage({ searchParams }: CapturePageProps) {
  if (process.env.README_CAPTURE !== "1") notFound();
  const requestedKind = (await searchParams).kind;
  const kind: PipelineKind = requestedKind === "retrieval" ? "retrieval" : "ingestion";
  return <ReadmePipelineCapture kind={kind} />;
}
