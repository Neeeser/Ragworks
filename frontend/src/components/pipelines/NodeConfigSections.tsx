"use client";

import { useEffect, useMemo } from "react";

import { VariablesTree } from "@/components/traces/debugger/VariablesTree";
import { CustomSelect } from "@/components/ui/custom-select";
import { ParameterFieldCard } from "@/components/ui/parameter-controls";
import { expressionSource } from "@/lib/expressions";
import { modelAvailability } from "@/lib/model-catalog-cache";
import { useAppConfig } from "@/providers/config-provider";

import { ChunkerTokenizerFields } from "./ChunkerTokenizerFields";
import { ConfigFieldRow } from "./ConfigFieldRow";
import { EmbeddingModelSelectorCard } from "./EmbeddingModelSelectorCard";
import { IndexBackendIcon } from "./icons/IndexBackendIcon";
import {
  ArgumentsEditor,
  OutputsEditor,
  argumentsFromConfig,
  outputsFromConfig,
} from "./IoDeclarationEditors";
import { buildPipelineConfigFields, coerceFieldValue } from "./lib/pipeline-config";
import { CREATE_SENTINEL } from "./lib/pipeline-kinds";
import { sortIndexesByName } from "./lib/pipeline-utils";
import {
  RETRIEVAL_INPUT_TYPE,
  RETRIEVAL_OUTPUT_TYPE,
  buildStaticEnvironment,
  declaredArguments,
} from "./lib/variable-env";

import type { PipelineConfigField } from "./lib/pipeline-config";
import type { PipelineNodeData } from "./PipelineNode";
import type {
  CatalogModel,
  IndexBackend,
  ModelCatalogResponse,
  PipelineValidationIssue,
  PipelineVariable,
  VectorIndex,
} from "@/lib/types";
import type { Node } from "@xyflow/react";

export type NodeConfigSectionsProps = {
  node: Node<PipelineNodeData>;
  onConfigChange: (config: Record<string, unknown>) => void;
  isPreview: boolean;
  validationErrors: string[];
  validationIssues?: PipelineValidationIssue[];
  vectorIndexes: VectorIndex[];
  onOpenIndexManager?: () => void;
  embeddingModels: CatalogModel[];
  embeddingCatalog: ModelCatalogResponse | null;
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  onCatalogVisible?: () => void;
  onSelectEmbeddingModel: (model: CatalogModel) => void;
  variables: PipelineVariable[];
  /** All canvas nodes (type + config) — source of declared arguments. */
  variableNodes: Array<{ type: string; config: Record<string, unknown> }>;
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
  validationIssues = [],
  vectorIndexes,
  onOpenIndexManager,
  embeddingModels,
  embeddingCatalog,
  embeddingModelsLoading,
  embeddingModelsError,
  onCatalogVisible,
  onSelectEmbeddingModel,
  variables,
  variableNodes,
}: NodeConfigSectionsProps) {
  const { config: appConfig } = useAppConfig();
  const nodeType = node.data.nodeType;
  const config = useMemo<Record<string, unknown>>(() => node.data.config ?? {}, [node]);
  const isEmbedder = nodeType === "embedder.text";
  const isChunker = nodeType.startsWith("chunker.");
  const isRetrievalInput = nodeType === RETRIEVAL_INPUT_TYPE;
  const isRetrievalOutput = nodeType === RETRIEVAL_OUTPUT_TYPE;

  // The static expression environment. For the retrieval input node the
  // drawer's draft arguments replace the canvas node's, so live feedback
  // tracks unsaved edits.
  const expressionEnv = useMemo(() => {
    const argumentSources = isRetrievalInput
      ? [
          ...variableNodes.filter((entry) => entry.type !== RETRIEVAL_INPUT_TYPE),
          { type: RETRIEVAL_INPUT_TYPE, config },
        ]
      : variableNodes;
    return buildStaticEnvironment(declaredArguments(argumentSources), variables);
  }, [isRetrievalInput, variableNodes, config, variables]);

  useEffect(() => {
    if (isEmbedder) onCatalogVisible?.();
  }, [isEmbedder, onCatalogVisible]);
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
    const embedderHidden =
      isEmbedder && ["connection_id", "model_name", "dimension"].includes(field.key);
    const vectorHidden = isVectorNode && ["backend", "index_name", "dimension"].includes(field.key);
    const chunkerTokenizerField = isChunker && ["tokenizer", "hf_model_id"].includes(field.key);
    const declarationField =
      (isRetrievalInput && field.key === "arguments") ||
      (isRetrievalOutput && field.key === "outputs");
    return !(embedderHidden || vectorHidden || chunkerTokenizerField || declarationField);
  });
  const selectedEmbeddingModelKey = typeof config.model_name === "string" ? config.model_name : "";
  const selectedEmbeddingConnectionId =
    typeof config.connection_id === "string" ? config.connection_id : null;
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

  const setConfigValue = (key: string, value: unknown | undefined) => {
    const nextConfig = { ...config };
    if (value === undefined) {
      delete nextConfig[key];
    } else {
      nextConfig[key] = value;
    }
    onConfigChange(nextConfig);
  };

  const handleConfigChange = (field: PipelineConfigField, rawValue: string | boolean) => {
    setConfigValue(field.key, coerceFieldValue(field, rawValue));
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

  const modelVariables = variables.filter((variable) => variable.type === "model");
  // A model binding writes both fields as member-access expressions in one
  // move; the bound variable's name is recovered from the connection_id one.
  const boundModelVariable = (() => {
    const source = expressionSource(config.connection_id);
    const match = source?.match(/^([a-z_][a-z0-9_]*)\.connection_id$/);
    return match ? match[1] : null;
  })();

  const handleModelBinding = (name: string) => {
    const nextConfig = { ...config };
    if (!name) {
      delete nextConfig.connection_id;
      delete nextConfig.model_name;
    } else {
      nextConfig.connection_id = { $expr: `${name}.connection_id` };
      nextConfig.model_name = { $expr: `${name}.model_name` };
    }
    delete nextConfig.dimension;
    onConfigChange(nextConfig);
  };

  return (
    <div className="space-y-4">
      {isEmbedder && !boundModelVariable ? (
        <EmbeddingModelSelectorCard
          models={embeddingModels}
          selectedModelKey={selectedEmbeddingModelKey}
          selectedConnectionId={selectedEmbeddingConnectionId}
          selectedAvailability={modelAvailability(
            embeddingCatalog,
            selectedEmbeddingConnectionId,
            selectedEmbeddingModelKey || null,
          )}
          modelsLoading={embeddingModelsLoading}
          modelsError={embeddingModelsError}
          onSelectModel={onSelectEmbeddingModel}
        />
      ) : null}
      {isEmbedder && modelVariables.length > 0 ? (
        <ParameterFieldCard
          label="Model variable"
          description="Bind the model to a pipeline variable instead of picking one here."
        >
          <CustomSelect
            value={boundModelVariable ?? ""}
            aria-label="Model variable binding"
            placeholder="Pick model directly"
            disabled={isPreview}
            options={[
              { value: "", label: "Pick model directly" },
              ...modelVariables.map((variable) => ({
                value: variable.name,
                label: variable.name,
              })),
            ]}
            onValueChange={handleModelBinding}
          />
        </ParameterFieldCard>
      ) : null}
      {isChunker ? (
        <ChunkerTokenizerFields
          config={config}
          disabled={isPreview}
          validationIssues={validationIssues}
          onConfigChange={onConfigChange}
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
                  <IndexBackendIcon backend={option.value} />
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
                ? [
                    {
                      value: indexValue,
                      label: `${indexValue} (not created yet)`,
                      icon: <IndexBackendIcon backend={nodeBackend} />,
                    },
                  ]
                : []),
              ...backendIndexes.map((index) => ({
                value: index.name,
                label: `${index.name}${
                  typeof index.dimension === "number" ? ` · ${index.dimension}d` : ""
                }`,
                icon: <IndexBackendIcon backend={index.backend} />,
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
      {isRetrievalInput ? (
        <ArgumentsEditor
          argumentsList={argumentsFromConfig(config)}
          onChange={(argumentsList) => setConfigValue("arguments", argumentsList)}
          reservedNames={new Set(variables.map((variable) => variable.name))}
          disabled={isPreview}
        />
      ) : null}
      {isRetrievalOutput ? (
        <OutputsEditor
          outputs={outputsFromConfig(config)}
          onChange={(outputs) => setConfigValue("outputs", outputs)}
          env={expressionEnv}
          disabled={isPreview}
        />
      ) : null}
      {filteredFields.length > 0 ? (
        <div className="space-y-3">
          {filteredFields.map((field) => (
            <ConfigFieldRow
              key={field.key}
              field={field}
              nodeId={node.id}
              config={config}
              env={expressionEnv}
              disabled={isPreview}
              issue={validationIssues.find((item) => item.field === field.key)}
              onValueChange={setConfigValue}
              onLiteralChange={handleConfigChange}
            />
          ))}
        </div>
      ) : !isEmbedder && !isVectorNode && !isRetrievalInput && !isRetrievalOutput ? (
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
