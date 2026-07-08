"use client";

import { ArrowRight } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";
import { ParameterFieldCard, ParameterInput } from "@/components/ui/parameter-controls";

import { EmbeddingModelSelectorCard } from "./EmbeddingModelSelectorCard";
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
import type { EmbeddingModelInfo, VectorIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";

type PipelineInspectorProps = {
  selectedNode: Node<PipelineNodeData> | null;
  configDraft: Record<string, unknown>;
  onConfigDraftChange: (value: Record<string, unknown>) => void;
  onLabelChange: (value: string) => void;
  onApplyConfig: () => void;
  isPreview?: boolean;
  validationErrors?: string[];
  applyDisabled?: boolean;
  pineconeIndexes?: VectorIndex[];
  onOpenIndexManager?: () => void;
  embeddingModels?: EmbeddingModelInfo[];
  embeddingModelsLoading?: boolean;
  embeddingModelsError?: string | null;
  onSelectEmbeddingModel?: (modelId: string) => void;
};

export function PipelineInspector({
  selectedNode,
  configDraft,
  onConfigDraftChange,
  onLabelChange,
  onApplyConfig,
  isPreview = false,
  validationErrors = [],
  applyDisabled = false,
  embeddingModels = [],
  embeddingModelsLoading = false,
  embeddingModelsError = null,
  pineconeIndexes = [],
  onOpenIndexManager,
  onSelectEmbeddingModel = () => undefined,
}: PipelineInspectorProps) {
  const isEmbedder = selectedNode?.data.nodeType === "embedder.openrouter";
  const isIndexNode =
    selectedNode?.data.nodeType === "indexer.pinecone" ||
    selectedNode?.data.nodeType === "indexer.pgvector" ||
    selectedNode?.data.nodeType === "retriever.pinecone" ||
    selectedNode?.data.nodeType === "retriever.pgvector";
  const fields = selectedNode?.data.configSchema
    ? buildPipelineConfigFields(selectedNode.data.configSchema)
    : [];
  const filteredFields = fields.filter((field) => {
    const embedderHidden = isEmbedder && ["model_name", "dimension"].includes(field.key);
    const indexHidden = isIndexNode && ["index_name", "dimension"].includes(field.key);
    return !(embedderHidden || indexHidden);
  });
  const selectedEmbeddingModelKey =
    typeof configDraft.model_name === "string" ? configDraft.model_name : "";
  // The index select only offers indexes on the node's own backend
  // (indexer.pgvector nodes pick pgvector indexes, Pinecone nodes Pinecone's).
  const nodeBackend = selectedNode?.data.nodeType.endsWith(".pgvector") ? "pgvector" : "pinecone";
  const sortedIndexes = useMemo(
    () => sortIndexesByName(pineconeIndexes.filter((index) => index.backend === nodeBackend)),
    [pineconeIndexes, nodeBackend],
  );
  const indexValue = typeof configDraft.index_name === "string" ? configDraft.index_name : "";
  const selectedIndex = sortedIndexes.find((index) => index.name === indexValue) ?? null;

  const handleConfigChange = (field: PipelineConfigField, rawValue: string | boolean) => {
    const nextValue = coerceFieldValue(field, rawValue);
    const nextDraft = { ...configDraft };
    if (nextValue === undefined) {
      delete nextDraft[field.key];
    } else {
      nextDraft[field.key] = nextValue;
    }
    onConfigDraftChange(nextDraft);
  };

  const handleIndexChange = (value: string) => {
    if (value === CREATE_SENTINEL) {
      onOpenIndexManager?.();
      return;
    }
    const nextDraft = { ...configDraft };
    if (!value) {
      delete nextDraft.index_name;
      delete nextDraft.dimension;
    } else {
      nextDraft.index_name = value;
      const index = sortedIndexes.find((item) => item.name === value);
      if (typeof index?.dimension === "number") {
        nextDraft.dimension = index.dimension;
      } else {
        delete nextDraft.dimension;
      }
    }
    onConfigDraftChange(nextDraft);
  };

  return (
    <GlassCard className="rounded-3xl p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Inspector</p>
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
            <p className="text-xs text-slate-400">Node type</p>
            <p className="text-sm text-white">{selectedNode.data.nodeType}</p>
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
            {isIndexNode ? (
              <div className="mt-2 space-y-3">
                <ParameterFieldCard
                  label="Pinecone index"
                  description="Select an index to target for retrieval or ingestion."
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
                  >
                    <option value="">Select an index</option>
                    {sortedIndexes.map((index) => (
                      <option key={index.name} value={index.name}>
                        {index.name}
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
                  const value = getInputValue(field, configDraft);
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
            ) : !isEmbedder ? (
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
          {!isPreview ? (
            <Button variant="secondary" onClick={onApplyConfig} disabled={applyDisabled}>
              Apply config
            </Button>
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
