import { cn } from "@/lib/utils";

export type NodeFamily =
  | "chunker"
  | "embedder"
  | "indexer"
  | "parser"
  | "retriever"
  | "reranker"
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
  reranker: "Rerankers",
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
  "reranker",
  "chat",
  "utility",
  "other",
];

const SLATE_BADGE = "text-slate-300";
const AMBER_BG = "bg-amber-400";
const AMBER_RING = "border-amber-400/60";

const NODE_FAMILY_STYLES: Record<
  NodeFamily,
  { accent: string; border: string; glow: string; badge: string }
> = {
  chunker: {
    accent: "bg-teal-400",
    border: "border-teal-400/40",
    glow: "shadow-[0_0_24px_rgba(45,212,191,0.15)]",
    badge: "text-teal-200",
  },
  embedder: {
    accent: AMBER_BG,
    border: "border-amber-400/40",
    glow: "shadow-[0_0_24px_rgba(251,191,36,0.2)]",
    badge: "text-amber-200",
  },
  indexer: {
    accent: "bg-cyan-400",
    border: "border-cyan-400/40",
    glow: "shadow-[0_0_24px_rgba(34,211,238,0.18)]",
    badge: "text-cyan-200",
  },
  parser: {
    accent: "bg-sky-400",
    border: "border-sky-400/40",
    glow: "shadow-[0_0_24px_rgba(56,189,248,0.15)]",
    badge: "text-sky-200",
  },
  retriever: {
    accent: "bg-emerald-400",
    border: "border-emerald-400/40",
    glow: "shadow-[0_0_24px_rgba(52,211,153,0.15)]",
    badge: "text-emerald-200",
  },
  reranker: {
    accent: "bg-fuchsia-400",
    border: "border-fuchsia-400/40",
    glow: "shadow-[0_0_24px_rgba(232,121,249,0.15)]",
    badge: "text-fuchsia-200",
  },
  router: {
    accent: "bg-blue-400",
    border: "border-blue-400/40",
    glow: "shadow-[0_0_24px_rgba(96,165,250,0.15)]",
    badge: "text-blue-200",
  },
  ingestion: {
    accent: "bg-slate-400",
    border: "border-slate-400/40",
    glow: "shadow-[0_0_24px_rgba(148,163,184,0.12)]",
    badge: SLATE_BADGE,
  },
  retrieval: {
    accent: "bg-indigo-400",
    border: "border-indigo-400/40",
    glow: "shadow-[0_0_24px_rgba(129,140,248,0.15)]",
    badge: "text-indigo-200",
  },
  chat: {
    accent: "bg-rose-400",
    border: "border-rose-400/40",
    glow: "shadow-[0_0_24px_rgba(251,113,133,0.15)]",
    badge: "text-rose-200",
  },
  utility: {
    accent: "bg-slate-500",
    border: "border-slate-500/40",
    glow: "shadow-[0_0_24px_rgba(100,116,139,0.12)]",
    badge: SLATE_BADGE,
  },
  other: {
    accent: "bg-slate-500",
    border: "border-slate-500/40",
    glow: "shadow-[0_0_24px_rgba(100,116,139,0.12)]",
    badge: SLATE_BADGE,
  },
};

const PORT_TYPE_STYLES: Record<string, { bg: string; ring: string }> = {
  document_source: { bg: "bg-sky-400", ring: "border-sky-400/60" },
  document: { bg: "bg-emerald-400", ring: "border-emerald-400/60" },
  chunk_batch: { bg: "bg-teal-400", ring: "border-teal-400/60" },
  embedded_batch: { bg: AMBER_BG, ring: AMBER_RING },
  indexed_batch: { bg: "bg-cyan-400", ring: "border-cyan-400/60" },
  query_request: { bg: "bg-indigo-400", ring: "border-indigo-400/60" },
  query_embedding: { bg: AMBER_BG, ring: AMBER_RING },
  retrieval_results: { bg: "bg-fuchsia-400", ring: "border-fuchsia-400/60" },
};

/**
 * Hex twins of PORT_TYPE_STYLES for SVG strokes/fills (edges, trace dot) --
 * Tailwind classes can't color an SVG path. Keep the two maps in sync.
 */
const PORT_TYPE_HEX: Record<string, string> = {
  document_source: "#38bdf8",
  document: "#34d399",
  chunk_batch: "#2dd4bf",
  embedded_batch: "#fbbf24",
  indexed_batch: "#22d3ee",
  query_request: "#818cf8",
  query_embedding: "#fbbf24",
  retrieval_results: "#e879f9",
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

export const getPortTypeHex = (dataType?: string) =>
  (dataType && PORT_TYPE_HEX[dataType]) || "#64748b";

export const getPortTypeLabel = (dataType?: string) =>
  (dataType && PORT_TYPE_LABELS[dataType]) || dataType || "data";

export const resolveNodeFamily = (nodeType: string): NodeFamily => {
  const prefix = nodeType.split(".")[0];
  if (prefix === "chunker") return "chunker";
  if (prefix === "embedder") return "embedder";
  if (prefix === "indexer") return "indexer";
  if (prefix === "parser") return "parser";
  if (prefix === "retriever") return "retriever";
  if (prefix === "reranker") return "reranker";
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
    handle: cn("bg-slate-700", style?.bg, style?.ring),
    dot: cn("bg-slate-600", style?.bg),
  };
};
