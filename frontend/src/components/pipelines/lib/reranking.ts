import type { NodeSpec } from "@/lib/types";

export const RERANKER_NODE_TYPE = "reranker.model";
export const RERANKER_PROVIDER_REQUIRED = "Add a reranking provider to continue";
export const RERANKER_PROVIDER_LOADING = "Checking reranking providers…";
export const RERANKER_PROVIDER_ERROR = "Unable to load provider connections.";

/** Preview a node spec, unless it is the reranker and no provider serves it. */
export const previewWithRerankerGate = (
  spec: NodeSpec,
  hasRerankingProvider: boolean,
  rerankingProviderMessage: string | null,
  previewNodeSpec: (candidate: NodeSpec) => void,
  setMessage: (message: string | null) => void,
) => {
  if (spec.type === RERANKER_NODE_TYPE && !hasRerankingProvider) {
    setMessage(rerankingProviderMessage ?? RERANKER_PROVIDER_REQUIRED);
    return;
  }
  previewNodeSpec(spec);
};
