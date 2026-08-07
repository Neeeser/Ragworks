"use client";

import { FileText, MessageCircleQuestion } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CHUNK_PRESETS,
  KIND_COPY,
  WizardProcessingStep,
  WizardRerankingStep,
  WizardReviewStep,
  type WizardRerankingCatalog,
} from "@/components/pipelines/CreatePipelineWizardSteps";
import { useWizardModelChoice } from "@/components/pipelines/hooks/use-wizard-model-choice";
import { useWizardScaffold } from "@/components/pipelines/hooks/use-wizard-scaffold";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { type IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";
import {
  backendSupportsTemplate,
  PIPELINE_TEMPLATES,
  templateById,
  type PipelineTemplate,
} from "@/components/pipelines/lib/pipeline-templates";
import { sortIndexesByName } from "@/components/pipelines/lib/pipeline-utils";
import { wizardSteps } from "@/components/pipelines/lib/wizard-steps";
import { INTAKE_PRESETS } from "@/components/pipelines/WizardIntakePresets";
import { WizardStoreStep } from "@/components/pipelines/WizardStoreStep";
import { WizardTemplateStep } from "@/components/pipelines/WizardTemplateStep";
import { Field, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell } from "@/components/ui/wizard-shell";
import { createPipeline } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { modelAvailability } from "@/lib/model-catalog-cache";
import { useAppConfig } from "@/providers/config-provider";

import type {
  BackendInfo,
  CatalogModel,
  IndexBackend,
  ModelCatalogResponse,
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
  embeddingCatalog: ModelCatalogResponse | null;
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
  reranking: WizardRerankingCatalog;
  onCatalogVisible?: () => void;
  onClose: () => void;
  onCreated: (pipeline: Pipeline) => void;
  onOpenIndexRegistry: () => void;
};

const chunkerDefaults = (nodeSpecs: NodeSpec[]) => {
  const defaults = nodeSpecs.find((spec) => spec.type === "chunker.token")?.default_config;
  return {
    size: typeof defaults?.chunk_size === "number" ? defaults.chunk_size : 512,
    overlap: typeof defaults?.chunk_overlap === "number" ? defaults.chunk_overlap : 200,
  };
};

export function CreatePipelineWizard({
  open,
  token,
  kind,
  indexes,
  backends,
  nodeSpecs,
  embeddingModels,
  embeddingCatalog,
  embeddingModelsLoading,
  embeddingModelsError,
  reranking,
  onCatalogVisible,
  onClose,
  onCreated,
  onOpenIndexRegistry,
}: CreatePipelineWizardProps) {
  const { config } = useAppConfig();
  const defaultBackend = config.indexing.default_backend;
  const copy = KIND_COPY[kind];
  const isIngestion = kind === "ingestion";

  const [stepIndex, setStepIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const defaultChunking = useMemo(() => chunkerDefaults(nodeSpecs), [nodeSpecs]);

  const onRerankingCatalogVisible = reranking.onVisible;
  useEffect(() => {
    if (!open) return;
    onCatalogVisible?.();
    onRerankingCatalogVisible();
  }, [onCatalogVisible, onRerankingCatalogVisible, open]);
  const [templateId, setTemplateId] = useState(PIPELINE_TEMPLATES[0].id);
  const [backend, setBackend] = useState<IndexBackend>(defaultBackend);
  const [name, setName] = useState("");
  const [indexName, setIndexName] = useState("");
  const embedding = useWizardModelChoice();
  const reranker = useWizardModelChoice();
  const [intake, setIntake] = useState<IntakeMode>("text");
  const [chunkSize, setChunkSize] = useState(defaultChunking.size);
  const [chunkOverlap, setChunkOverlap] = useState(defaultChunking.overlap);
  const [showAdvancedChunking, setShowAdvancedChunking] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setStepIndex(0);
      setMessage(null);
      setTemplateId(PIPELINE_TEMPLATES[0].id);
      setBackend(defaultBackend);
      setName("");
      setIndexName("");
      embedding.reset();
      reranker.reset();
      setIntake("text");
      setChunkSize(defaultChunking.size);
      setChunkOverlap(defaultChunking.overlap);
      setShowAdvancedChunking(false);
    }
    wasOpen.current = open;
  }, [open, defaultBackend, defaultChunking, embedding, reranker]);

  // Ingestion pipelines have no template picker; retrieval (tool) pipelines
  // start from one of the catalog templates.
  const template = templateById(templateId) ?? PIPELINE_TEMPLATES[0];
  const needsEmbedding = isIngestion || template.needsEmbedding;
  const needsReranker = !isIngestion && template.needsReranker;
  const needsStore = isIngestion || template.needsStore;

  const steps = useMemo(() => wizardSteps(isIngestion, template), [isIngestion, template]);

  const activeStep = steps[Math.min(stepIndex, steps.length - 1)]?.id ?? "review";

  const backendInfo = backends.find((info) => info.backend === backend) ?? null;
  const templateCompatible =
    isIngestion || !backendInfo || backendSupportsTemplate(template, backendInfo);
  const capabilityWarning =
    !isIngestion && backendInfo && !templateCompatible
      ? `${backendInfo.label} can't run "${template.label}". Pick a backend that supports it (ParadeDB / pgvector).`
      : null;

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
      (model) => model.id === embedding.modelId && model.connection_id === embedding.connectionId,
    ) ?? null;
  const selectedAvailability = modelAvailability(
    embeddingCatalog,
    embedding.connectionId,
    embedding.modelId || null,
  );
  const rerankingAvailability = modelAvailability(
    reranking.catalog,
    reranker.connectionId,
    reranker.modelId || null,
  );
  const selectedRerankerName =
    reranking.models.find(
      (model) => model.id === reranker.modelId && model.connection_id === reranker.connectionId,
    )?.name ??
    (reranker.modelId || null);
  const activeChunkPreset =
    CHUNK_PRESETS.find((preset) => preset.size === chunkSize && preset.overlap === chunkOverlap) ??
    null;

  const { definition, preview } = useWizardScaffold(
    {
      isIngestion,
      template,
      backend,
      backendInfo,
      indexName,
      indexDimension: selectedIndex?.dimension,
      embeddingModel: embedding.modelId,
      embeddingConnectionId: embedding.connectionId,
      rerankingModel: reranker.modelId,
      rerankingConnectionId: reranker.connectionId,
      intake,
      chunkSize,
      chunkOverlap,
    },
    nodeSpecs,
  );

  const embeddingReady = Boolean(
    embedding.modelId && embedding.connectionId && selectedAvailability !== "missing",
  );
  // The reranker node refuses to run without a connection and model, so the
  // wizard collects them rather than creating a pipeline that always fails.
  const rerankingReady = Boolean(
    reranker.modelId && reranker.connectionId && rerankingAvailability !== "missing",
  );
  const modelsReady = (!needsEmbedding || embeddingReady) && (!needsReranker || rerankingReady);

  const canProceed = () => {
    if (activeStep === "template") return true;
    if (activeStep === "basics") return name.trim().length > 0;
    if (activeStep === "store") return indexName.trim().length > 0 && templateCompatible;
    if (activeStep === "model" || activeStep === "processing") return embeddingReady;
    if (activeStep === "reranker") return rerankingReady;
    // Review: the Create button stays gated on available models (a background
    // refresh can drop a selection).
    return modelsReady;
  };

  const handleCreate = async () => {
    if (!modelsReady) {
      setMessage(
        needsEmbedding && !embeddingReady
          ? "Select an available embedding model before creating the pipeline."
          : "Select an available reranking model before creating the pipeline.",
      );
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      // No kind is sent: what the pipeline can do is derived from its graph.
      const created = await createPipeline(token, {
        name: name.trim(),
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

  /**
   * A failed attempt's banner describes what was submitted, so every edit to
   * what the next attempt will submit clears it — otherwise the wizard shows
   * a failure for options the user has already changed.
   */
  const clearAttemptMessage = () => setMessage(null);

  const handleTemplateSelect = (next: PipelineTemplate) => {
    clearAttemptMessage();
    setTemplateId(next.id);
  };

  const handleBackendSelect = (nextBackend: IndexBackend) => {
    if (nextBackend === backend) return;
    clearAttemptMessage();
    setBackend(nextBackend);
    setIndexName("");
  };

  const handleIndexSelect = (value: string) => {
    if (value === CREATE_SENTINEL) {
      onOpenIndexRegistry();
      return;
    }
    clearAttemptMessage();
    setIndexName(value);
  };

  return (
    <WizardShell
      open={open}
      title="Create pipeline"
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
      {activeStep === "template" && (
        <WizardTemplateStep selectedId={templateId} onSelect={handleTemplateSelect} />
      )}

      {activeStep === "basics" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-control border border-hairline bg-surface p-3">
            {isIngestion ? (
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan" aria-hidden />
            ) : (
              <MessageCircleQuestion
                className="mt-0.5 h-4 w-4 shrink-0 text-accent-violet"
                aria-hidden
              />
            )}
            <p className="max-w-[66ch] text-ui leading-relaxed text-body">
              {isIngestion ? copy.explainer : template.description}
            </p>
          </div>
          <Field label="Pipeline name">
            <TextInput
              type="text"
              placeholder={copy.namePlaceholder}
              required
              value={name}
              onChange={(event) => {
                clearAttemptMessage();
                setName(event.target.value);
              }}
            />
          </Field>
        </div>
      )}

      {activeStep === "store" && (
        <WizardStoreStep
          backends={backends}
          backend={backend}
          onBackendSelect={handleBackendSelect}
          backendIndexes={backendIndexes}
          indexName={indexName}
          onIndexSelect={handleIndexSelect}
          backendInfo={backendInfo}
          onOpenIndexRegistry={onOpenIndexRegistry}
          capabilityWarning={capabilityWarning}
        />
      )}

      {(activeStep === "processing" || activeStep === "model") && (
        <WizardProcessingStep
          kind={kind}
          intake={intake}
          onIntakeChange={(next) => {
            clearAttemptMessage();
            setIntake(next);
          }}
          chunkSize={chunkSize}
          chunkOverlap={chunkOverlap}
          onChunkChange={(size, overlap) => {
            clearAttemptMessage();
            setChunkSize(size);
            setChunkOverlap(overlap);
          }}
          showAdvancedChunking={showAdvancedChunking}
          onToggleAdvancedChunking={() => setShowAdvancedChunking((prev) => !prev)}
          embeddingModel={embedding.modelId}
          embeddingConnectionId={embedding.connectionId}
          embeddingConnectionLabel={embedding.connectionLabel}
          selectedAvailability={selectedAvailability}
          onSelectEmbeddingModel={(model) => {
            clearAttemptMessage();
            embedding.select(model);
          }}
          embeddingModels={embeddingModels}
          embeddingModelsLoading={embeddingModelsLoading}
          embeddingModelsError={embeddingModelsError}
          selectedIndex={selectedIndex}
          indexName={indexName}
        />
      )}

      {activeStep === "reranker" && (
        <WizardRerankingStep
          catalog={reranking}
          choice={reranker}
          availability={rerankingAvailability}
          onSelectModel={(model) => {
            clearAttemptMessage();
            reranker.select(model);
          }}
        />
      )}

      {activeStep === "review" && (
        <WizardReviewStep
          kind={kind}
          typeLabel={isIngestion ? "Ingestion" : template.label}
          name={name}
          backend={backend}
          indexName={indexName}
          showStore={needsStore}
          showEmbedding={needsEmbedding}
          selectedModelName={
            selectedModel?.name ??
            (embedding.modelId
              ? selectedAvailability === "missing"
                ? `${embedding.modelId} (Unavailable)`
                : embedding.modelId
              : null)
          }
          showReranking={needsReranker}
          rerankingModelName={selectedRerankerName}
          intakeLabel={
            isIngestion
              ? (INTAKE_PRESETS.find((preset) => preset.id === intake)?.label ?? null)
              : null
          }
          showChunking={isIngestion && intake !== "images"}
          chunkPresetLabel={activeChunkPreset?.label ?? null}
          chunkSize={chunkSize}
          chunkOverlap={chunkOverlap}
          preview={preview}
        />
      )}
    </WizardShell>
  );
}
