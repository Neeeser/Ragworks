import { resolveNodeFamily } from "./pipeline-theme";

import type { PipelineConfigField } from "./pipeline-config";

/** Which vector-store logomark to render beside a signature value. */
export type SignatureBackend = "pinecone" | "pgvector";

/**
 * The one readout a node card renders front-and-center: an instrument label,
 * the hero value, and an optional secondary detail line. `consumedKeys` are
 * the config keys the readout already displays, so the hidden-override count
 * doesn't double-report them.
 */
export type NodeSignature = {
  label: string;
  value: string;
  detail?: string;
  backend?: SignatureBackend;
  /** True when the hero value is unset/placeholder and should render muted. */
  missing?: boolean;
  consumedKeys: string[];
};

type ConfigReader = (key: string) => unknown;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const backendFromValue = (value: unknown): SignatureBackend | undefined =>
  value === "pinecone" || value === "pgvector" ? value : undefined;

const chunkerSignature = (read: ConfigReader, withStrategy: boolean): NodeSignature => {
  const size = asNumber(read("chunk_size"));
  const overlap = asNumber(read("chunk_overlap"));
  const strategy = withStrategy ? asString(read("strategy")) : undefined;
  const details = [overlap !== undefined ? `${overlap} overlap` : undefined, strategy].filter(
    Boolean,
  );
  return {
    label: "Chunk size",
    value: size !== undefined ? String(size) : "—",
    detail: details.length > 0 ? details.join(" · ") : undefined,
    missing: size === undefined,
    consumedKeys: withStrategy
      ? ["chunk_size", "chunk_overlap", "strategy"]
      : ["chunk_size", "chunk_overlap"],
  };
};

const indexSignature = (
  read: ConfigReader,
  backend: SignatureBackend | undefined,
  hasBackendKey: boolean,
): NodeSignature => {
  const indexName = asString(read("index_name"));
  const namespace = asString(read("namespace"));
  return {
    label: "Index",
    value: indexName ?? "no index selected",
    detail: namespace,
    backend,
    missing: indexName === undefined,
    consumedKeys: hasBackendKey
      ? ["index_name", "namespace", "backend"]
      : ["index_name", "namespace"],
  };
};

type SignatureResolver = (read: ConfigReader) => NodeSignature | null;

const vectorSignature: SignatureResolver = (read) =>
  indexSignature(read, backendFromValue(read("backend")), true);

/** Exact node-type resolvers; unlisted types fall back to family resolvers. */
const TYPE_SIGNATURES: Record<string, SignatureResolver> = {
  "chunker.collection": (read) => chunkerSignature(read, true),
  "indexer.vector": vectorSignature,
  "retriever.vector": vectorSignature,
  "indexer.pinecone": (read) => indexSignature(read, "pinecone", false),
  "retriever.pinecone": (read) => indexSignature(read, "pinecone", false),
  "indexer.pgvector": (read) => indexSignature(read, "pgvector", false),
  "retriever.pgvector": (read) => indexSignature(read, "pgvector", false),
  "indexer.bm25": vectorSignature,
  "retriever.bm25": vectorSignature,
  "fusion.rrf": (read) => {
    const k = asNumber(read("k"));
    const topK = asNumber(read("top_k"));
    return {
      label: "RRF k",
      value: k !== undefined ? String(k) : "60",
      detail: topK !== undefined ? `top ${topK}` : undefined,
      consumedKeys: ["k", "top_k"],
    };
  },
  "reranker.cross_encoder": (read) => {
    const enabled = read("enabled") === true;
    const model = asString(read("model_name"));
    return {
      label: "Model",
      value: enabled ? (model ?? "—") : "disabled",
      detail: enabled ? undefined : model,
      missing: !enabled,
      consumedKeys: ["enabled", "model_name"],
    };
  },
  "parser.document": (read) => {
    const mode = asString(read("mode"));
    return {
      label: "Mode",
      value: mode ?? "auto",
      consumedKeys: ["mode"],
    };
  },
  "retrieval.input": (read) => {
    const raw = read("arguments");
    const names = Array.isArray(raw)
      ? raw
          .map((entry) => (entry as { name?: unknown }).name)
          .filter((name): name is string => typeof name === "string")
      : [];
    if (names.length === 0) return null;
    return {
      label: "Arguments",
      value: names.join(", "),
      consumedKeys: ["arguments"],
    };
  },
};

const FAMILY_SIGNATURES: Partial<Record<ReturnType<typeof resolveNodeFamily>, SignatureResolver>> =
  {
    chunker: (read) => chunkerSignature(read, false),
    embedder: (read) => {
      const model = asString(read("model_name"));
      const dimension = asNumber(read("dimension"));
      return {
        label: "Model",
        value: model ?? "no model selected",
        detail: dimension !== undefined ? `${dimension} dimensions` : undefined,
        missing: model === undefined,
        consumedKeys: ["model_name", "dimension"],
      };
    },
    indexer: (read) => indexSignature(read, undefined, false),
    retriever: (read) => indexSignature(read, undefined, false),
  };

/** Reads a config key's effective value: explicit config first, schema default second. */
const makeReader =
  (config: Record<string, unknown>, fields: PipelineConfigField[]): ConfigReader =>
  (key) => {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      return config[key];
    }
    return fields.find((field) => field.key === key)?.defaultValue;
  };

/**
 * Resolves the signature readout for a node: the one piece of config that is
 * the node's identity (embedding model, chunk size, target index, ...).
 * Returns null for nodes with nothing to highlight (IO endpoints, routers).
 */
export const resolveNodeSignature = (
  nodeType: string,
  config: Record<string, unknown>,
  fields: PipelineConfigField[],
): NodeSignature | null => {
  const resolver = TYPE_SIGNATURES[nodeType] ?? FAMILY_SIGNATURES[resolveNodeFamily(nodeType)];
  return resolver ? resolver(makeReader(config, fields)) : null;
};

const sameValue = (a: unknown, b: unknown) => {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/**
 * Counts config entries the card hides but the user has edited away from the
 * schema default — the "· N edited settings" hint. Keys the signature readout
 * already shows are excluded.
 */
export const countHiddenOverrides = (
  config: Record<string, unknown>,
  fields: PipelineConfigField[],
  consumedKeys: readonly string[],
): number => {
  const consumed = new Set(consumedKeys);
  return Object.entries(config).filter(([key, value]) => {
    if (consumed.has(key)) return false;
    const field = fields.find((candidate) => candidate.key === key);
    return !sameValue(value, field?.defaultValue);
  }).length;
};
