import { cn } from "@/lib/utils";

export type NodeFamily =
  | "chunker"
  | "embedder"
  | "indexer"
  | "parser"
  | "retriever"
  | "ranking"
  | "router"
  | "ingestion"
  | "retrieval"
  | "chat"
  | "utility"
  | "other";

const NODE_FAMILY_LABELS: Record<NodeFamily, string> = {
  chunker: "Chunkers",
  embedder: "Embedders",
  indexer: "Indexers",
  parser: "Parsers",
  retriever: "Retrievers",
  ranking: "Ranking",
  router: "Routers",
  ingestion: "Ingestion",
  retrieval: "Retrieval",
  chat: "Chat",
  utility: "Utility",
  other: "Other",
};

const NODE_FAMILY_ORDER: NodeFamily[] = [
  "ingestion",
  "retrieval",
  "parser",
  "router",
  "chunker",
  "embedder",
  "indexer",
  "retriever",
  "ranking",
  "chat",
  "utility",
  "other",
];

type FamilyStyle = { accent: string; border: string; glow: string; badge: string };

// Neutral elevation for every family; identity comes from the accent/border/
// badge color, not a per-family glow. (Extracted so the literal appears once —
// Tailwind still sees it, and the class map stays JIT-visible.)
const GLOW = "shadow-elevation-2";

// Stage-token bg classes reused across the family and port maps; declared once
// as literals so Tailwind's JIT still sees them.
const NEUTRAL_BG = "bg-stage-neutral";
const EMBED_BG = "bg-stage-embed";
const CHUNK_BG = "bg-stage-chunk";

// Container "kind" and utility families share these; declared once so the
// stage-token classes aren't duplicated across entries.
const NEUTRAL_STYLE: FamilyStyle = {
  accent: NEUTRAL_BG,
  border: "border-stage-neutral/40",
  glow: GLOW,
  badge: "text-stage-neutral",
};
const ROUTER_STYLE: FamilyStyle = {
  accent: "bg-stage-router",
  border: "border-stage-router/40",
  glow: GLOW,
  badge: "text-stage-router",
};
// The ranking family: everything that reorders or cuts a result stream
// (fusion, rerankers, Result Limit) shares the rerank stage token.
const RERANK_STYLE: FamilyStyle = {
  accent: "bg-stage-rerank",
  border: "border-stage-rerank/40",
  glow: GLOW,
  badge: "text-stage-rerank",
};
const CHUNK_STYLE: FamilyStyle = {
  accent: CHUNK_BG,
  border: "border-stage-chunk/40",
  glow: GLOW,
  badge: "text-stage-chunk",
};

/**
 * Family styling is expressed in stage tokens (see globals.css), so pipeline
 * node accents flip with the theme instead of being pinned to a fixed hue.
 * The stage→family mapping preserves the established semantics (Parse=sky,
 * Chunk=teal, Embed=amber, Index=cyan, Retrieve=emerald, Chat=rose); container
 * "kind" families (ingestion/retrieval) and utility use neutral/router tokens.
 */
const NODE_FAMILY_STYLES: Record<NodeFamily, FamilyStyle> = {
  chunker: CHUNK_STYLE,
  embedder: {
    accent: EMBED_BG,
    border: "border-stage-embed/40",
    glow: GLOW,
    badge: "text-stage-embed",
  },
  indexer: {
    accent: "bg-stage-index",
    border: "border-stage-index/40",
    glow: GLOW,
    badge: "text-stage-index",
  },
  parser: {
    accent: "bg-stage-parse",
    border: "border-stage-parse/40",
    glow: GLOW,
    badge: "text-stage-parse",
  },
  retriever: {
    accent: "bg-stage-retrieve",
    border: "border-stage-retrieve/40",
    glow: GLOW,
    badge: "text-stage-retrieve",
  },
  ranking: RERANK_STYLE,
  router: ROUTER_STYLE,
  ingestion: NEUTRAL_STYLE,
  retrieval: ROUTER_STYLE,
  chat: {
    accent: "bg-stage-chat",
    border: "border-stage-chat/40",
    glow: GLOW,
    badge: "text-stage-chat",
  },
  utility: NEUTRAL_STYLE,
  other: NEUTRAL_STYLE,
};

/** Port data-type → stage token (Tailwind classes for handles/dots). */
const PORT_TYPE_STYLES: Record<string, { bg: string; ring: string }> = {
  document_source: { bg: "bg-stage-parse", ring: "border-stage-parse/60" },
  document: { bg: "bg-stage-retrieve", ring: "border-stage-retrieve/60" },
  chunk_batch: { bg: CHUNK_BG, ring: "border-stage-chunk/60" },
  embedded_batch: { bg: EMBED_BG, ring: "border-stage-embed/60" },
  indexed_batch: { bg: "bg-stage-index", ring: "border-stage-index/60" },
  query_request: { bg: "bg-stage-router", ring: "border-stage-router/60" },
  query_embedding: { bg: EMBED_BG, ring: "border-stage-embed/60" },
  retrieval_results: { bg: "bg-stage-rerank", ring: "border-stage-rerank/60" },
};

/**
 * CSS-variable twins of PORT_TYPE_STYLES for SVG strokes/fills (edges, trace
 * dot) -- Tailwind classes can't color an SVG element, and CSS var() only works
 * in an inline `style`, never a presentation attribute, so consumers must apply
 * these via style={{ stroke/fill }}. Values live in globals.css so they flip
 * with the theme. Keep the two maps in sync.
 */
const PORT_TYPE_VAR: Record<string, string> = {
  document_source: "var(--port-document-source)",
  document: "var(--port-document)",
  chunk_batch: "var(--port-chunk-batch)",
  embedded_batch: "var(--port-embedded-batch)",
  indexed_batch: "var(--port-indexed-batch)",
  query_request: "var(--port-query-request)",
  query_embedding: "var(--port-query-embedding)",
  retrieval_results: "var(--port-retrieval-results)",
};

const PORT_TYPE_LABELS: Record<string, string> = {
  document_source: "Source file",
  document: "Parsed document",
  chunk_batch: "Chunks",
  embedded_batch: "Embedded chunks",
  indexed_batch: "Indexed chunks",
  query_request: "Query",
  query_embedding: "Query embedding",
  retrieval_results: "Results",
};

/**
 * CSS-variable twins of NODE_FAMILY_STYLES for SVG fills (the pipeline
 * mini-map) — same rationale as PORT_TYPE_VAR. Keep in sync with the
 * Tailwind family styles above.
 */
const NEUTRAL_VAR = "var(--stage-neutral)";
const RERANK_VAR = "var(--stage-rerank)";
const ROUTER_VAR = "var(--stage-router)";

const NODE_FAMILY_VAR: Record<NodeFamily, string> = {
  chunker: "var(--stage-chunk)",
  embedder: "var(--stage-embed)",
  indexer: "var(--stage-index)",
  parser: "var(--stage-parse)",
  retriever: "var(--stage-retrieve)",
  ranking: RERANK_VAR,
  router: ROUTER_VAR,
  ingestion: NEUTRAL_VAR,
  retrieval: ROUTER_VAR,
  chat: "var(--stage-chat)",
  utility: NEUTRAL_VAR,
  other: NEUTRAL_VAR,
};

/** A theme-aware CSS color (var() reference) for a family's SVG fill. */
export const getNodeFamilyColorVar = (family: NodeFamily) => NODE_FAMILY_VAR[family];

/** A theme-aware CSS color (var() reference) for SVG fill/stroke via `style`. */
export const getPortTypeColorVar = (dataType?: string) =>
  (dataType && PORT_TYPE_VAR[dataType]) || "var(--port-default)";

export const getPortTypeLabel = (dataType?: string) =>
  (dataType && PORT_TYPE_LABELS[dataType]) || dataType || "data";

export const resolveNodeFamily = (nodeType: string): NodeFamily => {
  const prefix = nodeType.split(".")[0];
  if (prefix === "chunker") return "chunker";
  if (prefix === "embedder") return "embedder";
  if (prefix === "indexer") return "indexer";
  if (prefix === "parser") return "parser";
  if (prefix === "retriever") return "retriever";
  // One ranking family: fusion merges, rerankers reorder, limit cuts —
  // the same semantic stage, so they share a section and stage color.
  if (prefix === "fusion" || prefix === "reranker" || prefix === "limit") return "ranking";
  if (prefix === "router") return "router";
  if (prefix === "ingestion") return "ingestion";
  if (prefix === "retrieval") return "retrieval";
  if (prefix === "chat") return "chat";
  if (prefix === "utility") return "utility";
  return "other";
};

export const getNodeFamilyLabel = (family: NodeFamily) => NODE_FAMILY_LABELS[family];

export const getNodeFamilyOrder = () => NODE_FAMILY_ORDER.slice();

export const getNodeFamilyStyles = (family: NodeFamily) => NODE_FAMILY_STYLES[family];

export const getPortTypeClasses = (dataType?: string) => {
  const style = dataType ? PORT_TYPE_STYLES[dataType] : undefined;
  return {
    handle: cn(NEUTRAL_BG, style?.bg, style?.ring),
    dot: cn(NEUTRAL_BG, style?.bg),
  };
};
