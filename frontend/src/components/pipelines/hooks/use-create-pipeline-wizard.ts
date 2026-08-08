"use client";

import { useEffect, useMemo, useState } from "react";

import { CHUNK_PRESETS, KIND_COPY } from "@/components/pipelines/CreatePipelineWizardSteps";
import { useIndexEmbeddingSource } from "@/components/pipelines/hooks/use-index-embedding-source";
import { useResolvedEmbeddingDimension } from "@/components/pipelines/hooks/use-resolved-embedding-dimension";
import { useWizardCreate } from "@/components/pipelines/hooks/use-wizard-create";
import {
  unusableIndexes,
  useWizardIndexTarget,
} from "@/components/pipelines/hooks/use-wizard-index-target";
import { useWizardModelChoice } from "@/components/pipelines/hooks/use-wizard-model-choice";
import { useWizardName } from "@/components/pipelines/hooks/use-wizard-name";
import { useWizardScaffold } from "@/components/pipelines/hooks/use-wizard-scaffold";
import { useWizardTemplates } from "@/components/pipelines/hooks/use-wizard-templates";
import { intakeCapabilityVerdict } from "@/components/pipelines/lib/intake-capability";
import { CREATE_SENTINEL } from "@/components/pipelines/lib/pipeline-kinds";
import { type IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";
import { sortIndexesByName } from "@/components/pipelines/lib/pipeline-utils";
import { collectSaveBlockers } from "@/components/pipelines/lib/save-blockers";
import { wizardSteps } from "@/components/pipelines/lib/wizard-steps";
import { getErrorMessage } from "@/lib/errors";
import { modelAvailability } from "@/lib/model-catalog-cache";
import { useAppConfig } from "@/providers/config-provider";

import type { WizardRerankingCatalog } from "@/components/pipelines/CreatePipelineWizardSteps";
import type {
  BackendInfo,
  CatalogModel,
  IndexBackend,
  ModelCatalogResponse,
  NodeSpec,
  Pipeline,
  PipelineKind,
  ToolTemplate,
  VectorIndex,
} from "@/lib/types";

export type CreatePipelineWizardInput = {
  open: boolean;
  token: string;
  kind: PipelineKind;
  indexes: VectorIndex[];
  backends: BackendInfo[];
  nodeSpecs: NodeSpec[];
  embeddingModels: CatalogModel[];
  embeddingCatalog: ModelCatalogResponse | null;
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

/**
 * Every choice the create-pipeline wizard collects, and what those choices
 * make possible: which steps exist, which are reachable, the graph the server
 * would build from them, and why an attempt was refused.
 *
 * The component above this renders — the wizard's rules live here.
 */
export function useCreatePipelineWizard(input: CreatePipelineWizardInput) {
  const {
    open,
    token,
    kind,
    indexes,
    backends,
    nodeSpecs,
    embeddingModels,
    embeddingCatalog,
    reranking,
    onCatalogVisible,
    onClose,
    onCreated,
    onOpenIndexRegistry,
  } = input;
  const { config } = useAppConfig();
  const copy = KIND_COPY[kind];
  const isIngestion = kind === "ingestion";

  const [stepIndex, setStepIndex] = useState(0);
  const attempt = useWizardCreate(token, onCreated, onClose);
  const { message, setMessage } = attempt;
  const defaultChunking = useMemo(() => chunkerDefaults(nodeSpecs), [nodeSpecs]);

  const onRerankingCatalogVisible = reranking.onVisible;
  useEffect(() => {
    if (!open) return;
    onCatalogVisible?.();
    onRerankingCatalogVisible();
  }, [onCatalogVisible, onRerankingCatalogVisible, open]);

  const templates = useWizardTemplates(token, open);
  const [backend, setBackend] = useState<IndexBackend>(config.indexing.default_backend);
  const reranker = useWizardModelChoice();
  const [intake, setIntake] = useState<IntakeMode>("text");
  const [chunkSize, setChunkSize] = useState(defaultChunking.size);
  const [chunkOverlap, setChunkOverlap] = useState(defaultChunking.overlap);
  const [showAdvancedChunking, setShowAdvancedChunking] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);

  // Ingestion pipelines have no template picker; retrieval (tool) pipelines
  // start from one of the server's catalog templates.
  const template = templates.selected;
  const needsEmbedding = isIngestion || Boolean(template?.needs_embedding);
  const needsReranker = !isIngestion && Boolean(template?.needs_reranker);
  const needsStore = isIngestion || Boolean(template?.needs_store);
  // A tool pipeline is named after the template it starts from; the ingestion
  // wizard has no template, so its field stays empty behind its placeholder.
  const name = useWizardName(isIngestion ? "" : (template?.label ?? ""));
  // Which index kind the store step offers: the aggregates read a BM25 index,
  // so asking them for a dense one asks for a store they never touch.
  const indexVectorType = isIngestion ? "dense" : (template?.index_vector_type ?? "dense");

  const steps = useMemo(() => wizardSteps(isIngestion, template), [isIngestion, template]);
  const activeStep = steps[Math.min(stepIndex, steps.length - 1)]?.id ?? "review";

  const backendInfo = backends.find((info) => info.backend === backend) ?? null;
  const indexTarget = useWizardIndexTarget({
    token,
    backend,
    backendInfo,
    // Only an ingestion pipeline creates a store; a tool reads one that the
    // corpus already lives in.
    offerNew: isIngestion,
  });
  const indexName = indexTarget.name;
  const templateCompatible =
    isIngestion || !backendInfo || !template || template.supported_backends.includes(backend);
  const capabilityWarning =
    !isIngestion && backendInfo && template && !templateCompatible
      ? `${backendInfo.label} can't run "${template.label}". Pick a backend that supports it (ParadeDB / pgvector).`
      : null;

  // A dense-reading template picks the dense index and derives its BM25
  // sibling; a lexical one reads the sparse index directly.
  const backendIndexes = useMemo(
    () =>
      sortIndexesByName(
        indexes.filter(
          (index) =>
            index.backend === backend &&
            (indexVectorType === "sparse"
              ? index.vector_type === "sparse"
              : index.vector_type !== "sparse"),
        ),
      ),
    [indexes, backend, indexVectorType],
  );
  const selectedIndex = useMemo(
    () => backendIndexes.find((index) => index.name === indexName) ?? null,
    [backendIndexes, indexName],
  );

  // A tool pipeline must embed with the model that wrote the corpus, so its
  // index picks the model. An ingestion pipeline decides the model first and
  // the index follows from it — seeding there would hand the user the index's
  // existing embedder even where the intake it just chose rules that model
  // out.
  const indexEmbeddingModel = useIndexEmbeddingSource(
    token,
    backend,
    indexName,
    embeddingModels,
    open && !isIngestion && needsEmbedding && indexVectorType === "dense",
  );
  const embedding = useWizardModelChoice(indexEmbeddingModel);
  const selectedModel =
    embeddingModels.find(
      (model) => model.id === embedding.modelId && model.connection_id === embedding.connectionId,
    ) ?? null;
  // The catalog publishes no width for most embedding models, so the index
  // the wizard offers to create is sized from the resolved width — one
  // memoised lookup per (connection, model), never a probe per row.
  const embeddingDimension = useResolvedEmbeddingDimension(
    token,
    embedding.connectionId,
    embedding.modelId || null,
    selectedModel?.dimension,
  );
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
    reranking.models.find((model) => model.id === reranker.modelId)?.name ??
    (reranker.modelId || null);
  const activeChunkPreset =
    CHUNK_PRESETS.find((preset) => preset.size === chunkSize && preset.overlap === chunkOverlap) ??
    null;

  const scaffold = useWizardScaffold(
    {
      isIngestion,
      template,
      backend,
      backendInfo,
      indexName,
      // An existing index states the width its rows already carry; a new one
      // is sized by the model that will fill it.
      indexDimension:
        indexTarget.mode === "new" ? (embeddingDimension ?? undefined) : selectedIndex?.dimension,
      embeddingModel: embedding.modelId,
      embeddingConnectionId: embedding.connectionId,
      rerankingModel: reranker.modelId,
      rerankingConnectionId: reranker.connectionId,
      intake,
      chunkSize,
      chunkOverlap,
    },
    nodeSpecs,
    token,
  );
  const { definition, preview } = scaffold;

  const embeddingReady = Boolean(
    embedding.modelId && embedding.connectionId && selectedAvailability !== "missing",
  );
  // What the intake preset needs from the embedder. A stated conflict gates
  // the wizard; an unstated capability is a warning the user can dismiss,
  // because absence of a capability mark means "not stated", never "cannot".
  const capabilityVerdict = isIngestion
    ? intakeCapabilityVerdict(intake, selectedModel)
    : { status: "ok" as const };
  const capabilityConflict =
    capabilityVerdict.status === "conflict" ? capabilityVerdict.reason : null;
  const capabilityUnstated =
    capabilityVerdict.status === "unstated" && !warningDismissed ? capabilityVerdict.reason : null;
  // The reranker node refuses to run without a connection and model, so the
  // wizard collects them rather than creating a pipeline that always fails.
  const rerankingReady = Boolean(
    reranker.modelId && reranker.connectionId && rerankingAvailability !== "missing",
  );
  const modelsReady = (!needsEmbedding || embeddingReady) && (!needsReranker || rerankingReady);
  // The server builds a tool graph, so Create waits on the definition it will
  // submit rather than posting a half-built one.
  const definitionReady = isIngestion || Boolean(definition);

  // A new index the user names may already exist. Creating the pipeline then
  // silently writes the model's vectors into a store built for a different
  // width, and every upsert is rejected at ingest — so the name states the
  // clash where it is typed.
  const unusable = unusableIndexes(backendIndexes, embeddingDimension);
  const takenIndexReason =
    indexTarget.mode === "new" ? (unusable.get(indexName.trim()) ?? null) : null;
  const indexNameConflict = takenIndexReason
    ? `An index named ${indexName.trim()} already exists and ${takenIndexReason}. Name a different index, or pick an existing one.`
    : null;

  const stepSatisfied = (step: string) => {
    if (step === "template") return true;
    if (step === "basics") return name.value.trim().length > 0;
    if (step === "store") {
      return indexName.trim().length > 0 && templateCompatible && !indexNameConflict;
    }
    if (step === "model" || step === "processing") return embeddingReady && !capabilityConflict;
    if (step === "reranker") return rerankingReady;
    // Review: Create stays gated on available models (a background refresh can
    // drop a selection) and on the graph the server built.
    return modelsReady && definitionReady && !capabilityConflict && !indexNameConflict;
  };
  // The step list gates on the same rule as Next: clicking straight past a
  // required field otherwise submits a pipeline that never collected it.
  const firstUnsatisfied = steps.findIndex((step) => !stepSatisfied(step.id));

  // A refused definition names nodes, and the review step's graph draws them,
  // so the findings group under the node each one belongs to. A refusal that
  // carried no structured findings stays under the pipeline rather than being
  // dropped.
  const blockers = useMemo(() => {
    const failure = attempt.failure;
    if (!failure) return [];
    if (failure.issues.length === 0) {
      return [{ nodeId: null, label: "Pipeline", errors: failure.errors, issues: [] }];
    }
    return collectSaveBlockers({ nodes: preview.nodes, nodeErrors: {}, issues: failure.issues });
  }, [attempt.failure, preview.nodes]);

  /**
   * A failed attempt's banner describes what was submitted, so every edit to
   * what the next attempt will submit clears it — otherwise the wizard shows
   * a failure for options the user has already changed.
   */
  const clearAttemptMessage = () => setMessage(null);

  return {
    copy,
    isIngestion,
    templates,
    template,
    steps,
    stepIndex,
    activeStep,
    maxReachableStepIndex: firstUnsatisfied === -1 ? steps.length - 1 : firstUnsatisfied,
    canProceed: stepSatisfied(activeStep),
    creating: attempt.creating,
    message,
    name,
    backend,
    backendInfo,
    backendIndexes,
    indexName,
    indexTarget,
    unusableIndexes: unusable,
    indexNameConflict,
    embeddingDimension,
    indexVectorType,
    selectedIndex,
    capabilityWarning,
    capabilityConflict,
    capabilityUnstated,
    dismissCapabilityWarning: () => setWarningDismissed(true),
    embedding,
    indexEmbeddingModel,
    selectedModel,
    selectedAvailability,
    reranker,
    rerankingAvailability,
    selectedRerankerName,
    intake,
    chunkSize,
    chunkOverlap,
    activeChunkPreset,
    showAdvancedChunking,
    needsEmbedding,
    needsReranker,
    needsStore,
    preview,
    blockers,
    clearAttemptMessage,
    goToStep: setStepIndex,
    toggleAdvancedChunking: () => setShowAdvancedChunking((prev) => !prev),
    selectIntake: (next: IntakeMode) => {
      clearAttemptMessage();
      // The dismissal answered for the preset it was shown under; a new
      // preset asks a new question about the same model.
      setWarningDismissed(false);
      setIntake(next);
    },
    setChunking: (size: number, overlap: number) => {
      clearAttemptMessage();
      setChunkSize(size);
      setChunkOverlap(overlap);
    },
    selectTemplate: (next: ToolTemplate) => {
      if (next.id === template?.id) return;
      clearAttemptMessage();
      // A template reading the other kind of index cannot use the selected
      // one, and submitting it would point the graph at a store it never reads.
      if ((next.index_vector_type ?? "dense") !== indexVectorType) indexTarget.clearSelection();
      templates.select(next);
    },
    selectBackend: (nextBackend: IndexBackend) => {
      if (nextBackend === backend) return;
      clearAttemptMessage();
      setBackend(nextBackend);
      indexTarget.clearSelection();
    },
    selectIndex: (value: string) => {
      if (value === CREATE_SENTINEL) {
        onOpenIndexRegistry();
        return;
      }
      clearAttemptMessage();
      indexTarget.selectExisting(value);
    },
    create: () => {
      if (!modelsReady) {
        setMessage(
          needsEmbedding && !embeddingReady
            ? "Select an available embedding model before creating the pipeline."
            : "Select an available reranking model before creating the pipeline.",
        );
        return;
      }
      if (capabilityConflict) {
        setMessage(capabilityConflict);
        return;
      }
      if (!definition) {
        setMessage(scaffold.error ?? "The template's graph is still being built. Try again.");
        return;
      }
      // The store the pipeline names has to exist and be registered before
      // anything can be pointed at it again — including the collection wizard.
      void indexTarget
        .ensureCreated(embeddingDimension)
        .then(() => attempt.create(name.value, definition))
        .catch((error: unknown) =>
          setMessage(getErrorMessage(error, "Unable to create the index.")),
        );
    },
  };
}
