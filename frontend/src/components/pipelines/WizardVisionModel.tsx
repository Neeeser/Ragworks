"use client";

import { IntakeCapabilityNotice } from "@/components/pipelines/IntakeCapabilityNotice";
import { LlmModelSelectorCard } from "@/components/pipelines/LlmModelSelectorCard";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { catalogConnectionErrors } from "@/lib/model-catalog-cache";

import type { WizardModelCatalog } from "@/components/pipelines/CreatePipelineWizardSteps";
import type { WizardModelChoice } from "@/components/pipelines/hooks/use-wizard-model-choice";
import type { ModelAvailability } from "@/lib/model-catalog-cache";
import type { CatalogModel } from "@/lib/types";

type WizardVisionModelProps = {
  catalog: WizardModelCatalog;
  choice: WizardModelChoice;
  availability: ModelAvailability;
  onSelectModel: (model: CatalogModel) => void;
  conflict: string | null;
  capabilityUnknown: string | null;
  onDismissCapabilityWarning: () => void;
};

/**
 * The chat model the described-images intake sends its images to. Collected
 * beside the embedding model because the two answer different halves of that
 * preset: the vision model reads the images, the embedder reads the text it
 * writes.
 */
export function WizardVisionModel({
  catalog,
  choice,
  availability,
  onSelectModel,
  conflict,
  capabilityUnknown,
  onDismissCapabilityWarning,
}: WizardVisionModelProps) {
  return (
    <div>
      <InstrumentLabel>Vision model</InstrumentLabel>
      <p className="mt-0.5 max-w-[66ch] text-ui text-muted">
        Describes each image the parse nodes produce. It runs after chunking, so a description is
        one item of its own, embedded and indexed beside the document&apos;s chunks.
      </p>
      <div className="mt-2">
        <LlmModelSelectorCard
          models={catalog.models}
          selectedModelKey={choice.modelId}
          selectedConnectionId={choice.connectionId}
          selectedAvailability={availability}
          onSelectModel={onSelectModel}
          onRetry={catalog.onRetry}
          modelsLoading={catalog.loading}
          modelsError={catalog.error}
          connectionErrors={catalogConnectionErrors(catalog.catalog)}
        />
      </div>
      <IntakeCapabilityNotice
        conflict={conflict}
        unknown={capabilityUnknown}
        onDismissUnknown={onDismissCapabilityWarning}
      />
    </div>
  );
}
