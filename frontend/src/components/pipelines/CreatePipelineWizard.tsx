"use client";

import { FileText, MessageCircleQuestion, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { BackendCard } from "@/components/pipelines/BackendCard";
import {
  BACKEND_TITLES,
  CHUNK_PRESETS,
  WizardProcessingStep,
  WizardReviewStep,
} from "@/components/pipelines/CreatePipelineWizardSteps";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { buildDefaultDefinition } from "@/components/pipelines/lib/pipeline-scaffold";
import {
  sortIndexesByName,
  toFlowEdges,
  toFlowNodes,
} from "@/components/pipelines/lib/pipeline-utils";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell, type WizardStep } from "@/components/ui/wizard-shell";
import { createPipeline } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAppConfig } from "@/providers/config-provider";

import type {
  BackendInfo,
  CatalogModel,
  IndexBackend,
  NodeSpec,
  Pipeline,
  PipelineKind,
  VectorIndex,
} from "@/lib/types";

type CreatePipelineWizardProps = {
  open: boolean;
  token: string;
  kind: PipelineKind;
  indexes: VectorIndex[];
  backends: BackendInfo[];
  nodeSpecs: NodeSpec[];
  embeddingModels: CatalogModel[];
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  onClose: () => void;
  onCreated: (pipeline: Pipeline) => void;
  onOpenIndexManager: () => void;
};

const KIND_COPY: Record<
  PipelineKind,
  { headline: string; explainer: string; namePlaceholder: string }
> = {
  ingestion: {
    headline: "How your documents become searchable",
    explainer:
      "When you upload a document, this pipeline parses it, splits it into chunks, turns each chunk into an embedding, and writes them into your vector index.",
    namePlaceholder: "e.g. Research library ingestion",
  },
  retrieval: {
    headline: "How questions find the right chunks",
    explainer:
      "When you search or chat, this pipeline embeds the question and pulls the closest matching chunks out of your vector index.",
    namePlaceholder: "e.g. Research library retrieval",
  },
};

export function CreatePipelineWizard({
  open,
  token,
  kind,
  indexes,
  backends,
  nodeSpecs,
  embeddingModels,
  embeddingModelsLoading,
  embeddingModelsError,
  onClose,
  onCreated,
  onOpenIndexManager,
}: CreatePipelineWizardProps) {
  const { config } = useAppConfig();
  const defaultBackend = config.indexing.default_backend;
  const copy = KIND_COPY[kind];
  const steps: WizardStep[] = useMemo(
    () => [
      { id: "basics", label: "Name", description: "What this pipeline is for." },
      { id: "store", label: "Vector store", description: "Where the vectors live." },
      kind === "ingestion"
        ? { id: "processing", label: "Processing", description: "Chunking and embedding." }
        : { id: "model", label: "Embedding", description: "The model that embeds queries." },
      { id: "review", label: "Review", description: "Watch it flow, then create." },
    ],
    [kind],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [backend, setBackend] = useState<IndexBackend>(defaultBackend);
  const [name, setName] = useState("");
  const [indexName, setIndexName] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingConnectionId, setEmbeddingConnectionId] = useState<string | null>(null);
  const [chunkSize, setChunkSize] = useState(1024);
  const [chunkOverlap, setChunkOverlap] = useState(200);
  const [showAdvancedChunking, setShowAdvancedChunking] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setStepIndex(0);
      setMessage(null);
      setBackend(defaultBackend);
      setName("");
      setIndexName("");
      setEmbeddingModel("");
      setChunkSize(1024);
      setChunkOverlap(200);
      setShowAdvancedChunking(false);
    }
    wasOpen.current = open;
  }, [open, defaultBackend]);

  const backendInfo = backends.find((info) => info.backend === backend) ?? null;
  // The wizard picks the dense index; the BM25 sibling is derived from it.
  const backendIndexes = useMemo(
    () =>
      sortIndexesByName(
        indexes.filter((index) => index.backend === backend && index.vector_type !== "sparse"),
      ),
    [indexes, backend],
  );
  const selectedIndex = useMemo(
    () => backendIndexes.find((index) => index.name === indexName) ?? null,
    [backendIndexes, indexName],
  );
  const selectedModel =
    embeddingModels.find(
      (model) =>
        model.id === embeddingModel &&
        (!embeddingConnectionId || model.connection_id === embeddingConnectionId),
    ) ?? null;
  const activeChunkPreset =
    CHUNK_PRESETS.find((preset) => preset.size === chunkSize && preset.overlap === chunkOverlap) ??
    null;

  const definition = useMemo(
    () =>
      buildDefaultDefinition(kind, backend, {
        indexName: indexName.trim() || undefined,
        indexDimension: selectedIndex?.dimension ?? undefined,
        embeddingConnectionId: embeddingConnectionId || undefined,
        embeddingModel: embeddingModel || undefined,
        chunkSize,
        chunkOverlap,
        // Hybrid (semantic + BM25) scaffolds mirror the backend defaults;
        // omitted when the deployment can't serve sparse indexes.
        includeBm25: backendInfo?.lexical_available ?? false,
        indexNameMaxLength: backendInfo?.capabilities.index_name_max_length,
      }),
    [
      kind,
      backend,
      indexName,
      selectedIndex,
      embeddingModel,
      embeddingConnectionId,
      chunkSize,
      chunkOverlap,
      backendInfo,
    ],
  );

  const preview = useMemo(
    () => ({
      nodes: toFlowNodes(definition, nodeSpecs),
      edges: toFlowEdges(definition, nodeSpecs),
      steps: definition.nodes.map((node) => ({ nodeIds: [node.id] })),
    }),
    [definition, nodeSpecs],
  );

  const canProceed = () => {
    if (stepIndex === 0) return name.trim().length > 0;
    if (stepIndex === 1) return indexName.trim().length > 0;
    return true;
  };

  const handleCreate = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const created = await createPipeline(token, {
        name: name.trim(),
        kind,
        definition,
        change_summary: "Initial pipeline scaffold.",
      });
      onCreated(created);
      onClose();
    } catch (error) {
      setMessage(getErrorMessage(error, "Unable to create pipeline."));
    } finally {
      setCreating(false);
    }
  };

  const handleBackendSelect = (nextBackend: IndexBackend) => {
    if (nextBackend === backend) return;
    setBackend(nextBackend);
    setIndexName("");
  };

  const handleIndexSelect = (value: string) => {
    if (value === CREATE_SENTINEL) {
      onOpenIndexManager();
      return;
    }
    setIndexName(value);
  };

  return (
    <WizardShell
      open={open}
      title={kind === "ingestion" ? "Create an ingestion pipeline" : "Create a retrieval pipeline"}
      subtitle={copy.headline}
      steps={steps}
      activeStepIndex={stepIndex}
      message={message}
      onStepChange={setStepIndex}
      onClose={onClose}
      footer={
        <WizardFooter
          step={stepIndex}
          stepCount={steps.length}
          onBack={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
          onNext={() =>
            stepIndex < steps.length - 1
              ? setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))
              : handleCreate()
          }
          nextLabel="Create pipeline"
          nextDisabled={!canProceed()}
          busy={creating}
          onCancel={onClose}
        />
      }
    >
      {stepIndex === 0 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-hairline bg-surface p-4">
            {kind === "ingestion" ? (
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-accent-cyan" />
            ) : (
              <MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-accent-violet" />
            )}
            <p className="text-sm leading-relaxed text-body">{copy.explainer}</p>
          </div>
          <Field
            label="Pipeline name"
            labelClassName="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
          >
            <TextInput
              type="text"
              placeholder={copy.namePlaceholder}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
      )}

      {stepIndex === 1 && (
        <div className="space-y-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
              Vector store
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {backends.map((info) => (
                <BackendCard
                  key={info.backend}
                  info={info}
                  selected={info.backend === backend}
                  onSelect={handleBackendSelect}
                />
              ))}
            </div>
          </div>
          <Field
            label={`${BACKEND_TITLES[backend]} index`}
            labelClassName="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
          >
            <Select value={indexName} onChange={(event) => handleIndexSelect(event.target.value)}>
              <option value="">Select an index</option>
              {backendIndexes.map((index) => (
                <option key={index.name} value={index.name}>
                  {index.name}
                  {typeof index.dimension === "number" ? ` · ${index.dimension}d` : ""}
                </option>
              ))}
              <option value={CREATE_SENTINEL}>+ Add new index...</option>
            </Select>
          </Field>
          {backendInfo ? (
            <p className="text-xs text-muted">
              Up to {backendInfo.capabilities.max_dimension.toLocaleString()} dimensions · metrics:{" "}
              {backendInfo.capabilities.supported_metrics.join(", ")}
            </p>
          ) : null}
          {backendIndexes.length === 0 ? (
            <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-body">
              <p>No {BACKEND_TITLES[backend]} indexes yet — create one to continue.</p>
              <Button
                variant="secondary"
                onClick={onOpenIndexManager}
                className="mt-3 flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create index
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {stepIndex === 2 && (
        <WizardProcessingStep
          kind={kind}
          chunkSize={chunkSize}
          chunkOverlap={chunkOverlap}
          onChunkChange={(size, overlap) => {
            setChunkSize(size);
            setChunkOverlap(overlap);
          }}
          showAdvancedChunking={showAdvancedChunking}
          onToggleAdvancedChunking={() => setShowAdvancedChunking((prev) => !prev)}
          embeddingModel={embeddingModel}
          embeddingConnectionId={embeddingConnectionId}
          onSelectEmbeddingModel={(model) => {
            setEmbeddingModel(model.id);
            setEmbeddingConnectionId(model.connection_id);
          }}
          embeddingModels={embeddingModels}
          embeddingModelsLoading={embeddingModelsLoading}
          embeddingModelsError={embeddingModelsError}
          selectedIndex={selectedIndex}
          indexName={indexName}
        />
      )}

      {stepIndex === 3 && (
        <WizardReviewStep
          kind={kind}
          name={name}
          backend={backend}
          indexName={indexName}
          selectedModelName={selectedModel?.name ?? null}
          chunkPresetLabel={activeChunkPreset?.label ?? null}
          chunkSize={chunkSize}
          chunkOverlap={chunkOverlap}
          preview={preview}
        />
      )}
    </WizardShell>
  );
}
