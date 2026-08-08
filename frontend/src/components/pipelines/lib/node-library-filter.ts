import type { NodeFamily } from "./pipeline-theme";
import type { NodeSpec } from "@/lib/types";

/** One family section of the node catalog, as built by `buildNodeCatalog`. */
export type NodeCatalogGroup = { family: NodeFamily; specs: NodeSpec[] };

/**
 * Extra words that name a node type but appear in neither its catalog label
 * nor its type id. The vocabulary a user types comes from the graph in front
 * of them and from the retrieval literature, not from the registry — without
 * these, the palette answers "no nodes match" for a node sitting on the
 * canvas.
 */
export const NODE_SEARCH_ALIASES: Record<string, string[]> = {
  "retriever.vector": [
    "semantic retriever",
    "vector retriever",
    "dense retrieval",
    "similarity search",
    "nearest neighbour",
    "knn",
    "ann",
  ],
  "retriever.bm25": ["keyword retriever", "lexical retrieval", "sparse retrieval", "full text"],
  "indexer.vector": ["semantic indexer", "vector store", "upsert", "write embeddings"],
  "indexer.bm25": ["keyword index", "lexical index", "full text index"],
  "embedder.text": ["embeddings", "vectorize", "encode text"],
  "fusion.rrf": ["reciprocal rank fusion", "hybrid", "combine results", "merge rankings"],
  "reranker.model": ["cross encoder", "rerank"],
  "llm.rerank": ["listwise rerank", "llm judge"],
  "llm.generate": ["hyde", "query expansion", "query rewrite", "multi query"],
  "llm.transform": ["rewrite", "summarize"],
  "llm.describe": ["image caption", "vision", "alt text"],
  "limit.results": ["top k", "truncate", "cutoff"],
  "filter.dedupe": ["deduplicate", "duplicates", "distinct", "unique results"],
  "filter.score": ["minimum score", "score cutoff", "relevance threshold", "drop weak results"],
  "expand.context": [
    "parent document",
    "small to big",
    "sentence window",
    "surrounding chunks",
    "neighbours",
    "auto merging",
  ],
  "merge.items": ["concatenate", "union"],
  "chunker.token": ["split by tokens", "fixed size chunks"],
  "chunker.sentence": ["split by sentences"],
  "chunker.paragraph": ["split by paragraphs"],
  "chunker.semantic": ["split by meaning", "embedding split"],
  "parse.text": ["text extraction", "ocr", "document loader"],
  "parse.page_images": ["page render", "rasterize", "screenshot pages"],
  "parse.embedded_media": ["extract images", "attachments"],
  "image.resize": ["downscale", "scale images"],
  "image.tile": ["crop", "patches"],
  "count.bm25": ["term count", "corpus statistics"],
  "facet.bm25": ["facets", "aggregation"],
};

/**
 * Everything a query may match a node by: its catalog label, its type id, the
 * aliases above, and the labels its instances currently carry on the canvas.
 */
const specHaystack = (spec: NodeSpec, instanceLabels: string[]): string =>
  [spec.label, spec.type, ...(NODE_SEARCH_ALIASES[spec.type] ?? []), ...instanceLabels]
    .join(" ")
    .toLowerCase();

const matchesAll = (haystack: string, tokens: string[]) =>
  tokens.every((token) => haystack.includes(token));

/** Labels on canvas for a node type, deduplicated, for the search haystack. */
export const instanceLabelsByType = (
  nodes: Array<{ nodeType: string; label: string }>,
): Record<string, string[]> => {
  const byType: Record<string, string[]> = {};
  nodes.forEach(({ nodeType, label }) => {
    const labels = (byType[nodeType] ??= []);
    if (!labels.includes(label)) labels.push(label);
  });
  return byType;
};

/**
 * Narrow the catalog for the library panel.
 *
 * A non-empty search deliberately ignores the family filter — the rail narrows
 * browsing, but typing is a question about the whole catalog, and answering it
 * from inside one category silently hides the node the user is looking for.
 * A shell whose presets match survives with only the matching presets; a shell
 * that matches itself keeps its full preset list.
 *
 * Every whitespace-separated token must match somewhere, so "semantic
 * retriever" reaches the Retriever whose canvas instance carries that name and
 * word order costs nothing.
 */
export const filterNodeCatalog = (
  catalog: NodeCatalogGroup[],
  family: NodeFamily | null,
  search: string,
  instanceLabels: Record<string, string[]> = {},
): NodeCatalogGroup[] => {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return family ? catalog.filter((group) => group.family === family) : catalog;
  }
  return catalog
    .map((group) => ({
      family: group.family,
      specs: group.specs
        .map((spec) => {
          if (matchesAll(specHaystack(spec, instanceLabels[spec.type] ?? []), tokens)) return spec;
          const presets = (spec.presets ?? []).filter((preset) =>
            matchesAll(preset.label.toLowerCase(), tokens),
          );
          return presets.length > 0 ? { ...spec, presets } : null;
        })
        .filter((spec): spec is NodeSpec => spec !== null),
    }))
    .filter((group) => group.specs.length > 0);
};

/** Total node count of a group (presets not counted — they are configs, not nodes). */
export const groupNodeCount = (group: NodeCatalogGroup) => group.specs.length;

/** The description's first sentence, for one-line catalog rows. */
export const firstSentence = (description: string): string => {
  const match = description.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : description;
};
