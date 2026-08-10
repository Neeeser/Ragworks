import {
  buildDefaultPipelineFlow,
  buildIntakePipelineFlow,
} from "@/components/pipelines/lib/default-pipeline-flow";

import type { DefaultPipelineFlow } from "@/components/pipelines/lib/default-pipeline-flow";
import type { PipelineKind } from "@/lib/types";

/**
 * The pipeline rotation the landing hero and the README animation both play.
 *
 * Every scene is a graph the product actually scaffolds — the setup wizard's
 * hybrid pair, the create-pipeline wizard's tool templates, and its intake
 * variants — so a visitor is shown the presets they get, not an illustration
 * of them. Adding a scene is one `LANDING_SCENES` entry; `scenes.test.ts`
 * guards that every entry builds a self-consistent graph, and the README
 * capture reads the same list so the two can never show different cycles.
 */

export type LandingSceneKind = PipelineKind;

export type LandingScene = {
  id: string;
  kind: LandingSceneKind;
  /** Rendered above the graph in the README capture. */
  label: string;
  /** Build the scene's graph + playback stages. Pure — safe to memoize. */
  build: () => DefaultPipelineFlow;
};

export const LANDING_SCENES: LandingScene[] = [
  {
    id: "hybrid-ingestion",
    kind: "ingestion",
    label: "Hybrid ingestion",
    build: () => buildDefaultPipelineFlow("hybrid-ingestion"),
  },
  {
    id: "hybrid-search",
    kind: "retrieval",
    label: "Hybrid search",
    build: () => buildDefaultPipelineFlow("hybrid-search"),
  },
  {
    id: "multimodal-ingestion",
    kind: "ingestion",
    label: "Text and image ingestion",
    build: () => buildIntakePipelineFlow("text_images"),
  },
  {
    id: "described-image-ingestion",
    kind: "ingestion",
    label: "Described-image ingestion",
    build: () => buildIntakePipelineFlow("text_described_images"),
  },
  {
    id: "reranked-search",
    kind: "retrieval",
    label: "Reranked search",
    build: () => buildDefaultPipelineFlow("reranked-search"),
  },
  {
    id: "page-image-ingestion",
    kind: "ingestion",
    label: "Page-image ingestion",
    build: () => buildIntakePipelineFlow("images"),
  },
  {
    id: "count-matches",
    kind: "retrieval",
    label: "Count matches",
    build: () => buildDefaultPipelineFlow("count-matches"),
  },
  {
    id: "facet-by-source",
    kind: "retrieval",
    label: "Facet by source",
    build: () => buildDefaultPipelineFlow("facet-by-source"),
  },
];
