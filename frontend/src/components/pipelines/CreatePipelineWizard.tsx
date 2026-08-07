"use client";

import { FileText, MessageCircleQuestion } from "lucide-react";

import {
  WizardProcessingStep,
  WizardRerankingStep,
} from "@/components/pipelines/CreatePipelineWizardSteps";
import { useCreatePipelineWizard } from "@/components/pipelines/hooks/use-create-pipeline-wizard";
import { INTAKE_PRESETS } from "@/components/pipelines/WizardIntakePresets";
import { WizardReviewStep } from "@/components/pipelines/WizardReviewStep";
import { WizardStoreStep } from "@/components/pipelines/WizardStoreStep";
import { WizardTemplateStep } from "@/components/pipelines/WizardTemplateStep";
import { Field, TextInput } from "@/components/ui/field";
import { WizardFooter, WizardShell } from "@/components/ui/wizard-shell";

import type { CreatePipelineWizardInput } from "@/components/pipelines/hooks/use-create-pipeline-wizard";

type CreatePipelineWizardProps = CreatePipelineWizardInput & {
  embeddingModelsLoading: boolean;
  embeddingModelsError: string | null;
};

export function CreatePipelineWizard(props: CreatePipelineWizardProps) {
  const {
    open,
    kind,
    backends,
    embeddingModels,
    embeddingModelsLoading,
    embeddingModelsError,
    reranking,
    onClose,
    onOpenIndexRegistry,
  } = props;
  const wizard = useCreatePipelineWizard(props);
  const { copy, isIngestion, template, steps, stepIndex, activeStep, name } = wizard;

  return (
    <WizardShell
      open={open}
      title="Create pipeline"
      subtitle={copy.headline}
      steps={steps}
      activeStepIndex={stepIndex}
      maxReachableStepIndex={wizard.maxReachableStepIndex}
      message={wizard.message}
      onStepChange={wizard.goToStep}
      onClose={onClose}
      footer={
        <WizardFooter
          step={stepIndex}
          stepCount={steps.length}
          onBack={() => wizard.goToStep(Math.max(stepIndex - 1, 0))}
          onNext={() =>
            stepIndex < steps.length - 1
              ? wizard.goToStep(Math.min(stepIndex + 1, steps.length - 1))
              : wizard.create()
          }
          nextLabel="Create pipeline"
          nextDisabled={!wizard.canProceed}
          busy={wizard.creating}
          onCancel={onClose}
        />
      }
    >
      {activeStep === "template" && (
        <WizardTemplateStep
          templates={wizard.templates.all}
          selectedId={template?.id ?? ""}
          loading={wizard.templates.loading}
          error={wizard.templates.error}
          onSelect={wizard.selectTemplate}
        />
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
              {isIngestion ? copy.explainer : (template?.description ?? "")}
            </p>
          </div>
          <Field label="Pipeline name">
            <TextInput
              type="text"
              placeholder={copy.namePlaceholder}
              required
              value={name.value}
              onChange={(event) => {
                wizard.clearAttemptMessage();
                name.set(event.target.value);
              }}
            />
          </Field>
        </div>
      )}

      {activeStep === "store" && (
        <WizardStoreStep
          backends={backends}
          backend={wizard.backend}
          onBackendSelect={wizard.selectBackend}
          backendIndexes={wizard.backendIndexes}
          indexName={wizard.indexName}
          onIndexSelect={wizard.selectIndex}
          backendInfo={wizard.backendInfo}
          onOpenIndexRegistry={onOpenIndexRegistry}
          capabilityWarning={wizard.capabilityWarning}
          vectorType={wizard.indexVectorType}
        />
      )}

      {(activeStep === "processing" || activeStep === "model") && (
        <WizardProcessingStep
          kind={kind}
          token={props.token}
          intake={wizard.intake}
          onIntakeChange={wizard.selectIntake}
          chunkSize={wizard.chunkSize}
          chunkOverlap={wizard.chunkOverlap}
          onChunkChange={wizard.setChunking}
          showAdvancedChunking={wizard.showAdvancedChunking}
          onToggleAdvancedChunking={wizard.toggleAdvancedChunking}
          embeddingModel={wizard.embedding.modelId}
          embeddingConnectionId={wizard.embedding.connectionId}
          embeddingConnectionLabel={wizard.embedding.connectionLabel}
          selectedAvailability={wizard.selectedAvailability}
          onSelectEmbeddingModel={(model) => {
            wizard.clearAttemptMessage();
            wizard.embedding.select(model);
          }}
          embeddingModels={embeddingModels}
          embeddingModelsLoading={embeddingModelsLoading}
          embeddingModelsError={embeddingModelsError}
          selectedIndex={wizard.selectedIndex}
          indexName={wizard.indexName}
          indexEmbeddingModel={wizard.indexEmbeddingModel}
        />
      )}

      {activeStep === "reranker" && (
        <WizardRerankingStep
          catalog={reranking}
          choice={wizard.reranker}
          availability={wizard.rerankingAvailability}
          onSelectModel={(model) => {
            wizard.clearAttemptMessage();
            wizard.reranker.select(model);
          }}
        />
      )}

      {activeStep === "review" && (
        <WizardReviewStep
          kind={kind}
          typeLabel={isIngestion ? "Ingestion" : (template?.label ?? "Tool")}
          name={name.value}
          backend={wizard.backend}
          indexName={wizard.indexName}
          showStore={wizard.needsStore}
          showEmbedding={wizard.needsEmbedding}
          selectedModelName={
            wizard.selectedModel?.name ??
            (wizard.embedding.modelId
              ? wizard.selectedAvailability === "missing"
                ? `${wizard.embedding.modelId} (Unavailable)`
                : wizard.embedding.modelId
              : null)
          }
          showReranking={wizard.needsReranker}
          rerankingModelName={wizard.selectedRerankerName}
          intakeLabel={
            isIngestion
              ? (INTAKE_PRESETS.find((preset) => preset.id === wizard.intake)?.label ?? null)
              : null
          }
          showChunking={isIngestion && wizard.intake !== "images"}
          chunkPresetLabel={wizard.activeChunkPreset?.label ?? null}
          chunkSize={wizard.chunkSize}
          chunkOverlap={wizard.chunkOverlap}
          preview={wizard.preview}
          blockers={wizard.blockers}
        />
      )}
    </WizardShell>
  );
}
