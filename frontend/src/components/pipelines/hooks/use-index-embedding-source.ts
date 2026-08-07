"use client";

import { useMemo } from "react";

import { fetchPipelines } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import type {
  CatalogModel,
  IndexBackend,
  Pipeline,
  PipelineDefinition,
  PipelineNodeDefinition,
} from "@/lib/types";

/** Node types that write vectors into an index, and the one that produces them. */
const INDEXER_TYPE = "indexer.vector";
const EMBEDDER_TYPE = "embedder.text";

const configString = (node: PipelineNodeDefinition, key: string): string | null => {
  const value = node.config[key];
  return typeof value === "string" ? value : null;
};

/** Whether this definition writes the named dense index on the given backend. */
function writesIndex(
  definition: PipelineDefinition,
  backend: IndexBackend,
  indexName: string,
): boolean {
  return definition.nodes.some(
    (node) =>
      node.type === INDEXER_TYPE &&
      configString(node, "index_name") === indexName &&
      configString(node, "backend") === backend,
  );
}

/** The one embedder in a definition, or null when it has none or several. */
function soleEmbedder(definition: PipelineDefinition): PipelineNodeDefinition | null {
  const embedders = definition.nodes.filter((node) => node.type === EMBEDDER_TYPE);
  return embedders.length === 1 ? embedders[0] : null;
}

function embeddingOf(pipelines: Pipeline[], backend: IndexBackend, indexName: string) {
  for (const pipeline of pipelines) {
    if (!writesIndex(pipeline.definition, backend, indexName)) continue;
    const embedder = soleEmbedder(pipeline.definition);
    const connectionId = embedder ? configString(embedder, "connection_id") : null;
    const modelId = embedder ? configString(embedder, "model_name") : null;
    if (connectionId && modelId) return { connectionId, modelId };
  }
  return null;
}

/**
 * The embedding model whose vectors already sit in the selected index — the
 * `(connection, model)` pair on the ingestion pipeline that writes it.
 *
 * A query pipeline has to embed with the model that wrote the corpus or its
 * vectors land in a different space, so the wizard suggests that model rather
 * than leaving the user to remember which one a collection was built with.
 * Resolves to null whenever the answer is not unambiguous — no pipeline writes
 * the index, or the one that does embeds with more than one model.
 */
export function useIndexEmbeddingSource(
  token: string,
  backend: IndexBackend,
  indexName: string,
  models: CatalogModel[],
  enabled: boolean,
): CatalogModel | null {
  const query = useApiQuery(() => fetchPipelines(token, "ingestion"), [token], { enabled });
  const pipelines = query.data;

  return useMemo(() => {
    if (!pipelines || !indexName) return null;
    const source = embeddingOf(pipelines, backend, indexName);
    if (!source) return null;
    // Only a model the catalog still offers is suggested: selecting one it
    // dropped would seed the picker with an unavailable choice.
    return (
      models.find(
        (model) => model.id === source.modelId && model.connection_id === source.connectionId,
      ) ?? null
    );
  }, [pipelines, backend, indexName, models]);
}
