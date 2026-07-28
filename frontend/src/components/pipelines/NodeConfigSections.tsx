"use client";

import { useMemo } from "react";

import { ChunkWindowSummary } from "@/components/ui/chunk-window-summary";
import { CustomSelect } from "@/components/ui/custom-select";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { ParameterFieldCard } from "@/components/ui/parameter-controls";
import { expressionSource } from "@/lib/expressions";
import { useAppConfig } from "@/providers/config-provider";

import { ChunkerTokenizerFields } from "./ChunkerTokenizerFields";
import { ConfigFieldRow } from "./ConfigFieldRow";
import { IndexBackendIcon } from "./icons/IndexBackendIcon";
import { IndexSourceField } from "./IndexSourceField";
import {
  ArgumentsPicker,
  OutputsEditor,
  acceptedNamesFromConfig,
  outputsFromConfig,
} from "./IoDeclarationEditors";
import { buildPipelineConfigFields, coerceFieldValue, resolvedNumber } from "./lib/pipeline-config";
import { CREATE_SENTINEL } from "./lib/pipeline-kinds";
import { sortIndexesByName } from "./lib/pipeline-utils";
import { RERANKER_NODE_TYPE } from "./lib/reranking";
import {
  RETRIEVAL_INPUT_TYPE,
  RETRIEVAL_OUTPUT_TYPE,
  buildStaticEnvironment,
  expressionVariableNames,
  indexVariables,
} from "./lib/variable-env";
import { NodeModelSelectors } from "./NodeModelSelectors";

import type { PipelineConfigField } from "./lib/pipeline-config";
import type { IndexVariableDeclaration } from "./lib/variable-env";
import type { NodeModelCatalogProps } from "./NodeModelSelectors";
import type { PipelineNodeData } from "./PipelineNode";
import type {
  IndexBackend,
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
  onOpenIndexRegistry?: () => void;
  variables: PipelineVariable[];
  /** Declares a new pipeline-level index variable on the definition. */
  onDeclareIndexVariable?: (declaration: IndexVariableDeclaration) => void;
} & NodeModelCatalogProps;

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
  onOpenIndexRegistry,
  variables,
  onDeclareIndexVariable,
  ...modelCatalogProps
}: NodeConfigSectionsProps) {
  const { config: appConfig } = useAppConfig();
  const nodeType = node.data.nodeType;
  const config = useMemo<Record<string, unknown>>(() => node.data.config ?? {}, [node]);
  const isEmbedder = nodeType === "embedder.text";
  const isReranker = nodeType === RERANKER_NODE_TYPE;
  const isChunker = nodeType.startsWith("chunker.");
  const isRetrievalInput = nodeType === RETRIEVAL_INPUT_TYPE;
  const isRetrievalOutput = nodeType === RETRIEVAL_OUTPUT_TYPE;

  // The static expression environment — built from the definition's
  // variables alone (input-source ones included).
  const expressionEnv = useMemo(() => buildStaticEnvironment(variables), [variables]);

  const isVectorNode = nodeType.startsWith("indexer.") || nodeType.startsWith("retriever.");
  // BM25 nodes target sparse (lexical) indexes; dense nodes never list them.
  const isBm25Node = nodeType.endsWith(".bm25");
  // Unified and BM25 nodes select their backend in config; legacy nodes have
  // it pinned in the type id and get no picker.
  const backendSelectable = nodeType.endsWith(".vector") || isBm25Node;
  const nodeBackend: IndexBackend = backendSelectable
    ? // A slot-bound node carries an expression here, not a backend name.
      typeof config.backend === "string"
      ? (config.backend as IndexBackend)
      : appConfig.indexing.default_backend
    : nodeType.endsWith(".pgvector")
      ? "pgvector"
      : "pinecone";

  const fields = node.data.configSchema ? buildPipelineConfigFields(node.data.configSchema) : [];
  // An expression over siblings still has a knowable window, so resolve it
  // rather than declining to state the math; only a value that genuinely
  // depends on the run (a caller argument) is left unstated.
  const chunkSize = resolvedNumber("chunk_size", fields, config, expressionEnv);
  const chunkOverlap = resolvedNumber("chunk_overlap", fields, config, expressionEnv);
  const chunkWindow = {
    size: chunkSize ?? 0,
    overlap: chunkOverlap ?? 0,
    expression: chunkSize === null || chunkOverlap === null,
  };
  const filteredFields = fields.filter((field) => {
    const embedderHidden =
      isEmbedder && ["connection_id", "model_name", "dimension"].includes(field.key);
    const rerankerHidden = isReranker && ["connection_id", "model_name"].includes(field.key);
    const vectorHidden = isVectorNode && ["backend", "index_name", "dimension"].includes(field.key);
    const chunkerTokenizerField = isChunker && ["tokenizer", "hf_model_id"].includes(field.key);
    const declarationField =
      (isRetrievalInput && field.key === "arguments") ||
      (isRetrievalOutput && field.key === "outputs");
    return !(
      embedderHidden ||
      rerankerHidden ||
      vectorHidden ||
      chunkerTokenizerField ||
      declarationField
    );
  });
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
  // The index may come from a pipeline variable rather than be named here;
  // saying "Required" then reports a correct pipeline as unfinished.
  const boundIndexVariables = expressionVariableNames(config.index_name);

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
      onOpenIndexRegistry?.();
      return;
    }
    const nextConfig = { ...config };
    // Coming back from a slot, `backend` still holds its expression; leaving
    // it there keeps the node reading a variable it no longer names.
    if ("backend" in nextConfig && typeof nextConfig.backend !== "string") {
      nextConfig.backend = nodeBackend;
    }
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

  // Binding writes both identity fields in one move, so the backend travels
  // with the index and repointing the variable moves the whole node.
  const handleBindVariable = (name: string) => {
    if (!name) return;
    const nextConfig: Record<string, unknown> = {
      ...config,
      index_name: { $expr: `${name}.name` },
    };
    if ("backend" in nextConfig) nextConfig.backend = { $expr: `${name}.backend` };
    // The variable's index states its own width; a stale literal one would
    // contradict it the moment the variable is repointed.
    delete nextConfig.dimension;
    onConfigChange(nextConfig);
  };

  const handleDeclareVariable = (name: string) => {
    // It holds the index this node already names, so pulling it out into a
    // variable changes nothing about where data lands.
    onDeclareIndexVariable?.({
      name,
      vectorType: isBm25Node ? "sparse" : "dense",
      index: selectedIndex ?? backendIndexes[0] ?? null,
    });
    handleBindVariable(name);
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
    <div className="space-y-3">
      <NodeModelSelectors
        nodeType={nodeType}
        config={config}
        embeddingBoundToVariable={Boolean(boundModelVariable)}
        {...modelCatalogProps}
      />
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
          <InstrumentLabel>Vector store</InstrumentLabel>
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
                  className={`flex items-center gap-2 rounded-control border px-2 py-2 text-left transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet ${
                    active
                      ? "border-accent-violet/70 bg-accent-violet/10 text-primary"
                      : "border-hairline bg-surface text-body hover:border-strong"
                  }`}
                >
                  <IndexBackendIcon backend={option.value} />
                  <span className="min-w-0">
                    {/* The backend name is a literal (`pgvector`), so it stays
                        verbatim; the hint beside it is a label. */}
                    <span className="block truncate font-mono text-ui">{option.label}</span>
                    <span className="block truncate text-instrument text-meta">{option.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {isVectorNode ? (
        <IndexSourceField
          indexes={backendIndexes}
          backend={nodeBackend}
          indexValue={indexValue}
          variableName={boundIndexVariables?.[0] ?? null}
          variables={indexVariables(variables)}
          disabled={isPreview}
          onPickIndex={handleIndexChange}
          onBindVariable={handleBindVariable}
          onDeclareVariable={handleDeclareVariable}
          onOpenIndexRegistry={onOpenIndexRegistry}
        />
      ) : null}
      {isRetrievalInput ? (
        <ArgumentsPicker
          acceptedNames={acceptedNamesFromConfig(config)}
          onChange={(names) => setConfigValue("arguments", names)}
          variables={variables}
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
              siblingFields={fields}
              nodeId={node.id}
              config={config}
              env={expressionEnv}
              disabled={isPreview}
              issue={validationIssues.find((item) => item.field === field.key)}
              onValueChange={setConfigValue}
              onLiteralChange={handleConfigChange}
            />
          ))}
          {isChunker ? (
            <ChunkWindowSummary
              chunkSize={chunkWindow.size}
              chunkOverlap={chunkWindow.overlap}
              expression={chunkWindow.expression}
            />
          ) : null}
        </div>
      ) : !isEmbedder && !isReranker && !isVectorNode && !isRetrievalInput && !isRetrievalOutput ? (
        <p className="p-8 text-center text-ui text-muted">
          This node has no configurable settings.
        </p>
      ) : null}
      {validationErrors.length > 0 ? (
        <div
          role="alert"
          className="space-y-1 rounded-control border border-data-neg/40 bg-data-neg/10 px-3 py-2 text-ui text-data-neg"
        >
          {validationErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
