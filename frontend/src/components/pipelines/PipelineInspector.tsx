"use client";

import { ArrowRight, Check } from "lucide-react";
import { useMemo } from "react";

import { GlassCard } from "@/components/ui/panel";
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

type PipelineInspectorProps = {
  selectedNode: Node<PipelineNodeData> | null;
  onConfigChange: (config: Record<string, unknown>) => void;
  onLabelChange: (value: string) => void;
  isPreview?: boolean;
  validationErrors?: string[];
  vectorIndexes?: VectorIndex[];
  onOpenIndexManager?: () => void;
  embeddingModels?: EmbeddingModelInfo[];
  embeddingModelsLoading?: boolean;
  embeddingModelsError?: string | null;
  onSelectEmbeddingModel?: (modelId: string) => void;
};

const BACKEND_OPTIONS: Array<{ value: IndexBackend; label: string; hint: string }> = [
  { value: "pgvector", label: "pgvector", hint: "Built-in Postgres" },
  { value: "pinecone", label: "Pinecone", hint: "Managed cloud" },
];

/**
 * Node inspector. Edits apply to the canvas immediately -- there is no Apply
 * step; the Save panel is the only commit point for the pipeline itself.
 */
export function PipelineInspector({
  selectedNode,
  onConfigChange,
  onLabelChange,
  isPreview = false,
  validationErrors = [],
  embeddingModels = [],
  embeddingModelsLoading = false,
  embeddingModelsError = null,
  vectorIndexes = [],
  onOpenIndexManager,
  onSelectEmbeddingModel = () => undefined,
}: PipelineInspectorProps) {
  const { config: appConfig } = useAppConfig();
  const nodeType = selectedNode?.data.nodeType ?? "";
  const config = useMemo<Record<string, unknown>>(
    () => selectedNode?.data.config ?? {},
    [selectedNode],
  );
  const isEmbedder = nodeType === "embedder.openrouter";
  const isVectorNode = nodeType.startsWith("indexer.") || nodeType.startsWith("retriever.");
  // Unified nodes select their backend in config; legacy nodes have it pinned
  // in the type id and get no picker.
  const backendSelectable = nodeType.endsWith(".vector");
  const nodeBackend: IndexBackend = backendSelectable
    ? ((config.backend as IndexBackend) ?? appConfig.indexing.default_backend)
    : nodeType.endsWith(".pgvector")
      ? "pgvector"
      : "pinecone";

  const fields = selectedNode?.data.configSchema
    ? buildPipelineConfigFields(selectedNode.data.configSchema)
    : [];
  const filteredFields = fields.filter((field) => {
    const embedderHidden = isEmbedder && ["model_name", "dimension"].includes(field.key);
    const vectorHidden = isVectorNode && ["backend", "index_name", "dimension"].includes(field.key);
    return !(embedderHidden || vectorHidden);
  });
  const selectedEmbeddingModelKey = typeof config.model_name === "string" ? config.model_name : "";
  const backendIndexes = useMemo(
    () => sortIndexesByName(vectorIndexes.filter((index) => index.backend === nodeBackend)),
    [vectorIndexes, nodeBackend],
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
      if (typeof index?.dimension === "number") {
        nextConfig.dimension = index.dimension;
      } else {
        delete nextConfig.dimension;
      }
    }
    onConfigChange(nextConfig);
  };

  return (
    <GlassCard className="rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Inspector</p>
        {selectedNode && !isPreview ? (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Check className="h-3 w-3 text-emerald-300" /> changes apply instantly
          </span>
        ) : null}
      </div>
      {selectedNode ? (
        <div className="mt-4 space-y-3 text-sm">
          {isPreview ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
              Preview only. Drag this node into the canvas to add it.
            </div>
          ) : null}
          <div>
            <p className="text-xs text-slate-400">Node label</p>
            <input
              className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              value={selectedNode.data.label}
              onChange={(event) => onLabelChange(event.target.value)}
              readOnly={isPreview}
            />
          </div>
          <div>
            <p className="text-xs text-slate-400">Description</p>
            <p className="text-sm text-slate-200">
              {selectedNode.data.description || "No description available."}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Example</p>
            {selectedNode.data.example ? (
              <div className="mt-2 flex flex-col items-center gap-2 md:flex-row">
                <div className="w-full rounded-2xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-sky-200/70">Input</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">
                    {selectedNode.data.example.input}
                  </pre>
                </div>
                <ArrowRight className="h-4 w-4 rotate-90 text-slate-400 md:rotate-0" />
                <div className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-200/70">
                    Output
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">
                    {selectedNode.data.example.output}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
                No example available.
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400">Config</p>
            {isEmbedder ? (
              <div className="mt-2 space-y-3">
                <EmbeddingModelSelectorCard
                  models={embeddingModels}
                  selectedModelKey={selectedEmbeddingModelKey}
                  modelsLoading={embeddingModelsLoading}
                  modelsError={embeddingModelsError}
                  onSelectModel={onSelectEmbeddingModel}
                />
              </div>
            ) : null}
            {isVectorNode && backendSelectable ? (
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
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
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition ${
                          active
                            ? "border-violet-400/70 bg-violet-500/10 text-white"
                            : "border-white/10 bg-white/5 text-slate-300 hover:border-white/30"
                        }`}
                      >
                        {option.value === "pgvector" ? (
                          <PostgresIcon className="h-4 w-4 shrink-0" />
                        ) : (
                          <PineconeIcon className="h-4 w-4 shrink-0 text-slate-100" />
                        )}
                        <span>
                          <span className="block font-semibold">{option.label}</span>
                          <span className="block text-[10px] text-slate-500">{option.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {isVectorNode ? (
              <div className="mt-2 space-y-3">
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
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                    value={indexValue}
                    onChange={(event) => handleIndexChange(event.target.value)}
                    disabled={isPreview}
                    aria-label="Vector index"
                  >
                    <option value="">Select an index</option>
                    {indexValue && !selectedIndex ? (
                      <option value={indexValue}>{indexValue} (not created yet)</option>
                    ) : null}
                    {backendIndexes.map((index) => (
                      <option key={index.name} value={index.name}>
                        {index.name}
                        {typeof index.dimension === "number" ? ` · ${index.dimension}d` : ""}
                      </option>
                    ))}
                    <option value={CREATE_SENTINEL}>+ Add new index...</option>
                  </select>
                </ParameterFieldCard>
              </div>
            ) : null}
            {filteredFields.length > 0 ? (
              <div className="mt-2 space-y-3">
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
              <p className="mt-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
                This node has no configurable settings.
              </p>
            ) : null}
          </div>
          {validationErrors.length > 0 ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {validationErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          Select a node to inspect or tweak configuration.
        </p>
      )}
    </GlassCard>
  );
}
