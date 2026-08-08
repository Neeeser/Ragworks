import { cn } from "@/lib/utils";

export type NodeFamily =
  | "chunker"
  | "image"
  | "embedder"
  | "indexer"
  | "parsing"
  | "retriever"
  | "ranking"
  | "llm"
  | "ingestion"
  | "retrieval"
  | "chat"
  | "utility"
  | "other";

const NODE_FAMILY_LABELS: Record<NodeFamily, string> = {
  chunker: "Chunkers",
  image: "Images",
  embedder: "Embedders",
  indexer: "Indexers",
  parsing: "Parsing",
  retriever: "Retrievers",
  ranking: "Ranking",
  llm: "LLM",
  ingestion: "Ingestion",
  retrieval: "Retrieval",
  chat: "Chat",
  utility: "Utility",
  other: "Other",
};

const NODE_FAMILY_ORDER: NodeFamily[] = [
  "ingestion",
  "retrieval",
  "parsing",
  "chunker",
  "image",
  "embedder",
  "indexer",
  "retriever",
  "ranking",
  "llm",
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
// Image items have no pipeline stage of their own — they are a modality,
// not a step — so they carry the port's own hue rather than borrowing one.
const IMAGE_BG = "bg-port-items-image";

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
  // Image transforms act on a modality rather than a pipeline stage, so they
  // carry the image port's own hue — the same token their items travel on.
  image: {
    accent: IMAGE_BG,
    border: "border-port-items-image/40",
    glow: GLOW,
    badge: "text-port-items-image",
  },
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
  parsing: {
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
  // LLM processing nodes are chat-model calls, so they share the chat stage
  // token — one hue for "a language model runs here" across the console.
  llm: {
    accent: "bg-stage-chat",
    border: "border-stage-chat/40",
    glow: GLOW,
    badge: "text-stage-chat",
  },
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
// `handle` variants carry the trailing important flag as literals: xyflow's
// handle stylesheet is unlayered CSS, which beats Tailwind's layered utilities
// regardless of import order, and Tailwind only generates classes it can see
// verbatim in source — a runtime-appended "!" produces a class that was never
// built.
const PORT_TYPE_STYLES: Record<string, { bg: string; ring: string; handle: string }> = {
  items_file: {
    bg: "bg-stage-parse",
    ring: "border-stage-parse/60",
    handle: "bg-stage-parse!",
  },
  items_text: { bg: CHUNK_BG, ring: "border-stage-chunk/60", handle: "bg-stage-chunk!" },
  items_embedding: { bg: EMBED_BG, ring: "border-stage-embed/60", handle: "bg-stage-embed!" },
  items_image: {
    bg: IMAGE_BG,
    ring: "border-port-items-image/60",
    handle: "bg-port-items-image!",
  },
  items_scored: {
    bg: "bg-stage-rerank",
    ring: "border-stage-rerank/60",
    handle: "bg-stage-rerank!",
  },
  items: {
    bg: "bg-stage-neutral",
    ring: "border-stage-neutral/60",
    handle: "bg-stage-neutral!",
  },
  structured_values: {
    bg: "bg-stage-router",
    ring: "border-stage-router/60",
    handle: "bg-stage-router!",
  },
};

/**
 * CSS-variable twins of PORT_TYPE_STYLES for SVG strokes/fills (edges, trace
 * dot) -- Tailwind classes can't color an SVG element, and CSS var() only works
 * in an inline `style`, never a presentation attribute, so consumers must apply
 * these via style={{ stroke/fill }}. Values live in globals.css so they flip
 * with the theme. Keep the two maps in sync.
 */
const PORT_TYPE_VAR: Record<string, string> = {
  items_file: "var(--port-items-file)",
  items_text: "var(--port-items-text)",
  items_embedding: "var(--port-items-embedding)",
  items_image: "var(--port-items-image)",
  items_scored: "var(--port-items-scored)",
  items: "var(--port-default)",
  structured_values: "var(--port-structured-values)",
};

const PORT_TYPE_LABELS: Record<string, string> = {
  items_file: "File items",
  items_text: "Text items",
  items_embedding: "Embedded items",
  items_image: "Image items",
  items_scored: "Scored items",
  items: "Items",
  structured_values: "Structured values",
  result: "Result",
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
  image: "var(--port-items-image)",
  embedder: "var(--stage-embed)",
  indexer: "var(--stage-index)",
  parsing: "var(--stage-parse)",
  retriever: "var(--stage-retrieve)",
  ranking: RERANK_VAR,
  llm: "var(--stage-chat)",
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
  if (prefix === "parse") return "parsing";
  // Image transforms group by what they operate on, which is how a user scans
  // the rail for them.
  if (prefix === "image") return "image";
  if (prefix === "retriever") return "retriever";
  // Count/facet read an index like a retriever — same semantic stage/color.
  if (prefix === "count" || prefix === "facet") return "retriever";
  // One ranking family: fusion merges, rerankers reorder, limit cuts, the
  // filters drop, and expand widens — the same semantic stage, so they share a
  // section and stage color.
  if (
    prefix === "fusion" ||
    prefix === "reranker" ||
    prefix === "limit" ||
    prefix === "filter" ||
    prefix === "expand"
  )
    return "ranking";
  if (prefix === "llm") return "llm";
  if (prefix === "ingestion") return "ingestion";
  if (prefix === "retrieval") return "retrieval";
  // tool.* terminals are boundary nodes like retrieval.output.
  if (prefix === "tool") return "retrieval";
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
    handle: cn("bg-stage-neutral!", style?.handle),
    dot: cn(NEUTRAL_BG, style?.bg),
    ring: cn("border-stage-neutral/60", style?.ring),
  };
};
