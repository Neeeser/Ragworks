import { notFound } from "next/navigation";

import { LANDING_SCENES } from "@/components/landing/lib/scenes";
import { ReadmePipelineCapture } from "@/components/readme/ReadmePipelineCapture";

type CapturePageProps = {
  searchParams: Promise<{ scene?: string }>;
};

export default async function CapturePage({ searchParams }: CapturePageProps) {
  if (process.env.README_CAPTURE !== "1") notFound();
  const requested = (await searchParams).scene;
  // The capture script walks the same registry the landing hero rotates, so an
  // unknown id means the two lists disagree — fail rather than record a scene
  // nobody asked for.
  const scene = LANDING_SCENES.find((candidate) => candidate.id === requested);
  if (!scene) notFound();
  return <ReadmePipelineCapture sceneId={scene.id} />;
}
