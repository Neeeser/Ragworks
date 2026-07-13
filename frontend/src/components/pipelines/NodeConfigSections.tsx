"use client";

import { useMemo } from "react";

import { VariablesTree } from "@/components/traces/debugger/VariablesTree";
import { CustomSelect } from "@/components/ui/custom-select";
import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";
import { useAppConfig } from "@/providers/config-provider";

import { EmbeddingModelSelectorCard } from "./EmbeddingModelSelectorCard";
import { PineconeIcon } from "./icons/PineconeIcon";
import { PostgresIcon } from "./icons/PostgresIcon";
import {
  buildPipelineConfigFields,
  coerceFieldValue,
  formatConfigValue,
  getInputValue,
} from "./lib/pipeline-config";
import { CREATE_SENTINEL } from "./lib/pipeline-kinds";
import { sortIndexesByName } from "./lib/pipeline-utils";

import type { PipelineConfigField } from "./lib/pipeline-config";
import type { PipelineNodeData } from "./PipelineNode";
import type { EmbeddingModelInfo, IndexBackend, VectorIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";

export type NodeConfigSectionsProps = {
  node: Node<PipelineNodeData>;
  onConfigChange: (config: Record<string, unknown>) => void;
  isPreview: boolean;
  validationErrors: string[];
  vectorIndexes: VectorIndex[];
  onOpenIndexManager?: () => void;
  embeddingModels: EmbeddingModelInfo[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  onSelectEmbeddingModel: (modelId: string) => void;
};

const BACKEND_OPTIONS: Array<{ value: IndexBackend; label: string; hint: string }> = [
  { value: "pgvector", label: "pgvector", hint: "Built-in Postgres" },
  { value: "pinecone", label: "Pinecone", hint: "Managed cloud" },
];

/**
 * The configuration body of the node editor drawer: model/backend/index pickers
 * for the nodes that have them, then the remaining schema-driven fields, the
 * description + example, and any validation errors. Edits apply to the canvas
 * immediately -- saving a revision is the only commit point.
 */
export function NodeConfigSections({
  node,
  onConfigChange,
  isPreview,
  validationErrors,
  vectorIndexes,
  onOpenIndexManager,
  embeddingModels,
  embeddingModelsLoading,
  embeddingModelsError,
  onSelectEmbeddingModel,
}: NodeConfigSectionsProps) {
  const { config: appConfig } = useAppConfig();
  const nodeType = node.data.nodeType;
  const config = useMemo<Record<string, unknown>>(() => node.data.config ?? {}, [node]);
  const isEmbedder = nodeType === "embedder.openrouter";
  const isVectorNode = nodeType.startsWith("indexer.") || nodeType.startsWith("retriever.");
  // BM25 nodes target sparse (lexical) indexes; dense nodes never list them.
  const isBm25Node = nodeType.endsWith(".bm25");
  // Unified and BM25 nodes select their backend in config; legacy nodes have
  // it pinned in the type id and get no picker.
  const backendSelectable = nodeType.endsWith(".vector") || isBm25Node;
  const nodeBackend: IndexBackend = backendSelectable
    ? ((config.backend as IndexBackend) ?? appConfig.indexing.default_backend)
    : nodeType.endsWith(".pgvector")
      ? "pgvector"
      : "pinecone";

  const fields = node.data.configSchema ? buildPipelineConfigFields(node.data.configSchema) : [];
  const filteredFields = fields.filter((field) => {
    const embedderHidden = isEmbedder && ["model_name", "dimension"].includes(field.key);
    const vectorHidden = isVectorNode && ["backend", "index_name", "dimension"].includes(field.key);
    return !(embedderHidden || vectorHidden);
  });
  const selectedEmbeddingModelKey = typeof config.model_name === "string" ? config.model_name : "";
  const backendIndexes = useMemo(
    () =>
      sortIndexesByName(
        vectorIndexes.filter(
          (index) =>
            index.backend === nodeBackend &&
            (isBm25Node ? index.vector_type === "sparse" : index.vector_type !== "sparse"),
        ),
      ),
    [vectorIndexes, nodeBackend, isBm25Node],
  );
  const indexValue = typeof config.index_name === "string" ? config.index_name : "";
  const selectedIndex = backendIndexes.find((index) => index.name === indexValue) ?? null;

  const handleConfigChange = (field: PipelineConfigField, rawValue: string | boolean) => {
    const nextValue = coerceFieldValue(field, rawValue);
    const nextConfig = { ...config };
    if (nextValue === undefined) {
      delete nextConfig[field.key];
    } else {
      nextConfig[field.key] = nextValue;
    }
    onConfigChange(nextConfig);
  };

  const handleBackendChange = (backend: IndexBackend) => {
    if (backend === nodeBackend) return;
    const nextConfig: Record<string, unknown> = { ...config, backend };
    delete nextConfig.index_name;
    delete nextConfig.dimension;
    onConfigChange(nextConfig);
  };

  const handleIndexChange = (value: string) => {
    if (value === CREATE_SENTINEL) {
      onOpenIndexManager?.();
      return;
    }
    const nextConfig = { ...config };
    if (!value) {
      delete nextConfig.index_name;
      delete nextConfig.dimension;
    } else {
      nextConfig.index_name = value;
      const index = backendIndexes.find((item) => item.name === value);
      // BM25 configs carry no dimension — sparse indexes are text-scored.
      if (!isBm25Node && typeof index?.dimension === "number") {
        nextConfig.dimension = index.dimension;
      } else {
        delete nextConfig.dimension;
      }
    }
    onConfigChange(nextConfig);
  };

  return (
    <div className="space-y-4">
      {isEmbedder ? (
        <EmbeddingModelSelectorCard
          models={embeddingModels}
          selectedModelKey={selectedEmbeddingModelKey}
          modelsLoading={embeddingModelsLoading}
          modelsError={embeddingModelsError}
          onSelectModel={onSelectEmbeddingModel}
        />
      ) : null}
      {isVectorNode && backendSelectable ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted">
            Vector store
          </p>
          <div
            className="mt-2 grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="Vector store backend"
          >
            {BACKEND_OPTIONS.map((option) => {
              const active = option.value === nodeBackend;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={isPreview}
                  onClick={() => handleBackendChange(option.value)}
                  className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition focus-visible:ring-2 focus-visible:ring-accent-violet ${
                    active
                      ? "border-accent-violet/70 bg-accent-violet/10 text-primary"
                      : "border-hairline bg-surface text-body hover:border-strong"
                  }`}
                >
                  {option.value === "pgvector" ? (
                    <PostgresIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <PineconeIcon className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <span>
                    <span className="block font-semibold">{option.label}</span>
                    <span className="block text-[10px] text-meta">{option.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {isVectorNode ? (
        <ParameterFieldCard
          label="Index"
          description="The vector index this node reads from or writes to."
          helper={
            indexValue
              ? selectedIndex?.dimension
                ? `Dimension: ${selectedIndex.dimension}`
                : "Dimension: n/a"
              : "Required"
          }
          actionLabel="Manage"
          actionDisabled={isPreview}
          onAction={onOpenIndexManager}
        >
          <CustomSelect
            value={indexValue}
            onValueChange={handleIndexChange}
            disabled={isPreview}
            aria-label="Vector index"
            placeholder="Select an index"
            options={[
              { value: "", label: "Select an index" },
              ...(indexValue && !selectedIndex
                ? [{ value: indexValue, label: `${indexValue} (not created yet)` }]
                : []),
              ...backendIndexes.map((index) => ({
                value: index.name,
                label: `${index.name}${
                  typeof index.dimension === "number" ? ` · ${index.dimension}d` : ""
                }`,
              })),
              {
                value: CREATE_SENTINEL,
                label: "+ Add new index...",
                preventFocusRestore: true,
              },
            ]}
          />
        </ParameterFieldCard>
      ) : null}
      {filteredFields.length > 0 ? (
        <div className="space-y-3">
          {filteredFields.map((field) => {
            const value = getInputValue(field, config);
            const helper =
              field.defaultValue !== undefined
                ? `Default: ${formatConfigValue(field.defaultValue)}`
                : field.required
                  ? "Required"
                  : undefined;

            return (
              <ParameterFieldCard
                key={field.key}
                label={field.label}
                description={field.description}
                helper={helper}
              >
                <ParameterInput
                  input={field.input}
                  value={value}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  placeholder={field.placeholder}
                  options={field.options}
                  disabled={isPreview}
                  onChange={(nextValue) => handleConfigChange(field, nextValue)}
                />
              </ParameterFieldCard>
            );
          })}
        </div>
      ) : !isEmbedder && !isVectorNode ? (
        <p className="rounded-2xl border border-hairline bg-surface px-3 py-2 text-xs text-body">
          This node has no configurable settings.
        </p>
      ) : null}
      {validationErrors.length > 0 ? (
        <div className="rounded-2xl border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-xs text-data-neg">
          {validationErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The node's one-paragraph description, shown first under the drawer header. */
export function NodeDescription({ node }: { node: Node<PipelineNodeData> }) {
  return (
    <p className="text-sm leading-relaxed text-body">
      {node.data.description || "No description available."}
    </p>
  );
}

/**
 * Example input/output rendered with the trace viewer's VariablesTree so node
 * IO reads the same everywhere in the product.
 */
export function NodeExampleSection({ node }: { node: Node<PipelineNodeData> }) {
  const example = node.data.example;
  if (!example) return null;
  return (
    <div className="space-y-4 border-t border-hairline pt-4">
      <VariablesTree
        title="Inputs"
        tone="cyan"
        summaryItems={[{ label: "example", value: example.input, kind: "text" }]}
        ioRecords={[]}
        emptySummaryLabel="No inputs recorded."
      />
      <VariablesTree
        title="Outputs"
        tone="violet"
        summaryItems={[{ label: "example", value: example.output, kind: "text" }]}
        ioRecords={[]}
        emptySummaryLabel="No outputs recorded."
      />
    </div>
  );
}
