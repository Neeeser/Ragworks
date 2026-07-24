"use client";

import { FileText, MessageCircleQuestion } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CHUNK_PRESETS,
  KIND_COPY,
  WizardProcessingStep,
  WizardReviewStep,
} from "@/components/pipelines/CreatePipelineWizardSteps";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { layoutPipelineNodes } from "@/components/pipelines/lib/pipeline-layout";
import { buildTopologyPlaybackSteps } from "@/components/pipelines/lib/pipeline-playback";
import { buildDefaultDefinition } from "@/components/pipelines/lib/pipeline-scaffold";
import {
  backendSupportsTemplate,
  PIPELINE_TEMPLATES,
  templateById,
  type PipelineTemplate,
} from "@/components/pipelines/lib/pipeline-templates";
import {
  sortIndexesByName,
  toFlowEdges,
  toFlowNodes,
} from "@/components/pipelines/lib/pipeline-utils";
import { WizardStoreStep } from "@/components/pipelines/WizardStoreStep";
import { WizardTemplateStep } from "@/components/pipelines/WizardTemplateStep";
import { Field, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell, type WizardStep } from "@/components/ui/wizard-shell";
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
  onCatalogVisible?: () => void;
  onClose: () => void;
  onCreated: (pipeline: Pipeline) => void;
  onOpenIndexManager: () => void;
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
  onCatalogVisible,
  onClose,
  onCreated,
  onOpenIndexManager,
}: CreatePipelineWizardProps) {
  const { config } = useAppConfig();
  const defaultBackend = config.indexing.default_backend;
  const copy = KIND_COPY[kind];
  const isIngestion = kind === "ingestion";

  const [stepIndex, setStepIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const defaultChunking = useMemo(() => chunkerDefaults(nodeSpecs), [nodeSpecs]);

  useEffect(() => {
    if (open) onCatalogVisible?.();
  }, [onCatalogVisible, open]);
  const [templateId, setTemplateId] = useState(PIPELINE_TEMPLATES[0].id);
  const [backend, setBackend] = useState<IndexBackend>(defaultBackend);
  const [name, setName] = useState("");
  const [indexName, setIndexName] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingConnectionId, setEmbeddingConnectionId] = useState<string | null>(null);
  const [embeddingConnectionLabel, setEmbeddingConnectionLabel] = useState<string | null>(null);
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
      setEmbeddingModel("");
      setEmbeddingConnectionId(null);
      setEmbeddingConnectionLabel(null);
      setChunkSize(defaultChunking.size);
      setChunkOverlap(defaultChunking.overlap);
      setShowAdvancedChunking(false);
    }
    wasOpen.current = open;
  }, [open, defaultBackend, defaultChunking]);

  // Ingestion pipelines have no template picker; retrieval (tool) pipelines
  // start from one of the catalog templates.
  const template = templateById(templateId) ?? PIPELINE_TEMPLATES[0];
  const needsEmbedding = isIngestion || template.needsEmbedding;
  const needsStore = isIngestion || template.needsStore;

  const steps: WizardStep[] = useMemo(() => {
    if (isIngestion) {
      return [
        { id: "basics", label: "Name", description: "What this pipeline is for." },
        { id: "store", label: "Vector store", description: "Where the vectors live." },
        { id: "processing", label: "Processing", description: "Chunking and embedding." },
        { id: "review", label: "Review", description: "Watch it flow, then create." },
      ];
    }
    const retrievalSteps: WizardStep[] = [
      { id: "template", label: "Template", description: "The kind of tool to build." },
      { id: "basics", label: "Name", description: "What this pipeline is for." },
    ];
    // The blank scaffold has no store-bound node, so there's nothing to point
    // at an index — skip store selection and build it in the editor.
    if (template.needsStore) {
      retrievalSteps.push({
        id: "store",
        label: "Vector store",
        description: "Where the data lives.",
      });
    }
    if (template.needsEmbedding) {
      retrievalSteps.push({
        id: "model",
        label: "Embedding",
        description: "The model that embeds queries.",
      });
    }
    retrievalSteps.push({
      id: "review",
      label: "Review",
      description: "Watch it flow, then create.",
    });
    return retrievalSteps;
  }, [isIngestion, template]);

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
      (model) => model.id === embeddingModel && model.connection_id === embeddingConnectionId,
    ) ?? null;
  const selectedAvailability = modelAvailability(
    embeddingCatalog,
    embeddingConnectionId,
    embeddingModel || null,
  );
  const activeChunkPreset =
    CHUNK_PRESETS.find((preset) => preset.size === chunkSize && preset.overlap === chunkOverlap) ??
    null;

  const definition = useMemo(() => {
    const options = {
      indexName: indexName.trim() || undefined,
      indexDimension: selectedIndex?.dimension ?? undefined,
      embeddingConnectionId: embeddingConnectionId || undefined,
      embeddingModel: embeddingModel || undefined,
      // Hybrid (semantic + BM25) scaffolds mirror the backend defaults;
      // omitted when the deployment can't serve sparse indexes.
      includeBm25: backendInfo?.lexical_available ?? false,
      indexNameMaxLength: backendInfo?.capabilities.index_name_max_length,
    };
    if (isIngestion) {
      return buildDefaultDefinition("ingestion", backend, { ...options, chunkSize, chunkOverlap });
    }
    return template.build(backend, options);
  }, [
    isIngestion,
    template,
    backend,
    indexName,
    selectedIndex,
    embeddingModel,
    embeddingConnectionId,
    chunkSize,
    chunkOverlap,
    backendInfo,
  ]);

  const preview = useMemo(() => {
    // Scaffolds carry no positions; the preview is placed by the same
    // algorithm the editor and Tidy use.
    const edges = toFlowEdges(definition, nodeSpecs);
    return {
      nodes: layoutPipelineNodes(toFlowNodes(definition, nodeSpecs), edges),
      edges,
      steps: buildTopologyPlaybackSteps(definition),
    };
  }, [definition, nodeSpecs]);

  const embeddingReady = Boolean(
    embeddingModel && embeddingConnectionId && selectedAvailability !== "missing",
  );

  const canProceed = () => {
    if (activeStep === "template") return true;
    if (activeStep === "basics") return name.trim().length > 0;
    if (activeStep === "store") return indexName.trim().length > 0 && templateCompatible;
    if (activeStep === "model" || activeStep === "processing") return embeddingReady;
    // Review: the Create button stays gated on an available embedding model
    // for pipelines that embed (a background refresh can drop the selection).
    return !needsEmbedding || embeddingReady;
  };

  const handleCreate = async () => {
    if (
      needsEmbedding &&
      (!embeddingModel || !embeddingConnectionId || selectedAvailability === "missing")
    ) {
      setMessage("Select an available embedding model before creating the pipeline.");
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

  const handleTemplateSelect = (next: PipelineTemplate) => {
    setTemplateId(next.id);
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
      title={isIngestion ? "Create an ingestion pipeline" : "Create a search tool pipeline"}
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
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-hairline bg-surface p-4">
            {isIngestion ? (
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-accent-cyan" />
            ) : (
              <MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-accent-violet" />
            )}
            <p className="text-sm leading-relaxed text-body">
              {isIngestion ? copy.explainer : template.description}
            </p>
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

      {activeStep === "store" && (
        <WizardStoreStep
          backends={backends}
          backend={backend}
          onBackendSelect={handleBackendSelect}
          backendIndexes={backendIndexes}
          indexName={indexName}
          onIndexSelect={handleIndexSelect}
          backendInfo={backendInfo}
          onOpenIndexManager={onOpenIndexManager}
          capabilityWarning={capabilityWarning}
        />
      )}

      {(activeStep === "processing" || activeStep === "model") && (
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
          embeddingConnectionLabel={embeddingConnectionLabel}
          selectedAvailability={selectedAvailability}
          onSelectEmbeddingModel={(model) => {
            setEmbeddingModel(model.id);
            setEmbeddingConnectionId(model.connection_id);
            setEmbeddingConnectionLabel(model.connection_label);
          }}
          embeddingModels={embeddingModels}
          embeddingModelsLoading={embeddingModelsLoading}
          embeddingModelsError={embeddingModelsError}
          selectedIndex={selectedIndex}
          indexName={indexName}
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
            (embeddingModel
              ? selectedAvailability === "missing"
                ? `${embeddingModel} (Unavailable)`
                : embeddingModel
              : null)
          }
          chunkPresetLabel={activeChunkPreset?.label ?? null}
          chunkSize={chunkSize}
          chunkOverlap={chunkOverlap}
          preview={preview}
        />
      )}
    </WizardShell>
  );
}
