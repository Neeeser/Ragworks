import {
  ChunkerExplanation,
  EmbedderExplanation,
  IndexerExplanation,
  IngestionInputExplanation,
  IngestionOutputExplanation,
  ParseTextExplanation,
} from "@/components/traces/explanations/IngestionExplanation";
import { EffectNote, Lede } from "@/components/traces/explanations/prose";
import {
  FusionExplanation,
  GenericRankingExplanation,
  QueryEmbedderExplanation,
  RerankerExplanation,
  RetrievalInputExplanation,
  RetrievalOutputExplanation,
  RetrieverExplanation,
} from "@/components/traces/explanations/RetrievalExplanation";
import { journeySentence } from "@/components/traces/lib/journey-sentences";

import type { NodeExplanationProps } from "@/components/traces/explanations/types";
import type { ComponentType } from "react";

type ExplanationRenderer = {
  matches: (nodeType: string, props: NodeExplanationProps) => boolean;
  Component: ComponentType<NodeExplanationProps>;
};

const RENDERERS: ExplanationRenderer[] = [
  { matches: (type) => type === "ingestion.input", Component: IngestionInputExplanation },
  { matches: (type) => type === "parse.text", Component: ParseTextExplanation },
  { matches: (type) => type.startsWith("chunker."), Component: ChunkerExplanation },
  {
    matches: (type, props) => type === "embedder.text" && props.step.stage === "retrieval",
    Component: QueryEmbedderExplanation,
  },
  { matches: (type) => type === "embedder.text", Component: EmbedderExplanation },
  { matches: (type) => type.startsWith("indexer."), Component: IndexerExplanation },
  { matches: (type) => type === "ingestion.output", Component: IngestionOutputExplanation },
  { matches: (type) => type === "retrieval.input", Component: RetrievalInputExplanation },
  { matches: (type) => type.startsWith("retriever."), Component: RetrieverExplanation },
  { matches: (type) => type.startsWith("fusion."), Component: FusionExplanation },
  { matches: (type) => type.startsWith("reranker."), Component: RerankerExplanation },
  { matches: (type) => type === "retrieval.output", Component: RetrievalOutputExplanation },
  {
    matches: (_type, props) =>
      props.step.run?.summary.outputs.some((value) => value.kind === "ranking") ?? false,
    Component: GenericRankingExplanation,
  },
];

/** Renderer registry for node-specific debugging explanations. */
export function NodeExplanation(props: NodeExplanationProps) {
  const nodeType = props.node.data.nodeType;
  const renderer = RENDERERS.find((entry) => entry.matches(nodeType, props));
  if (renderer) {
    const { Component } = renderer;
    return <Component {...props} />;
  }
  return (
    <div className="max-w-3xl space-y-3">
      <Lede>
        {props.node.data.description ??
          "Recorded inputs, outputs, and configuration for this node."}
      </Lede>
      {props.itemEffect ? <EffectNote>{journeySentence(props.itemEffect)}</EffectNote> : null}
    </div>
  );
}
