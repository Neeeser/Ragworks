/**
 * The create-pipeline wizard's step list.
 *
 * Which steps exist depends on the pipeline kind and, for tool pipelines, on
 * what the chosen template declares it needs — a template that embeds queries
 * gets an embedding step, one that reranks gets a reranking step.
 */
import type { WizardStep } from "@/components/ui/wizard-shell";
import type { ToolTemplate } from "@/lib/types";

// Processing precedes the store: what the pipeline reads and the model it
// embeds with decide the vector width, and the width decides which index can
// hold the result. Asking for the index first makes the user commit to a
// store before knowing what has to fit in it.
const INGESTION_STEPS: WizardStep[] = [
  { id: "basics", label: "Name", description: "What this pipeline is for." },
  {
    id: "processing",
    label: "Processing",
    description: "How files are read, and the model that embeds the result.",
  },
  { id: "store", label: "Vector store", description: "Where the vectors live." },
  { id: "review", label: "Review", description: "The graph this pipeline will run." },
];

const REVIEW_STEP: WizardStep = {
  id: "review",
  label: "Review",
  description: "The graph this pipeline will run.",
};

/** The steps to render for one pipeline kind and template. */
export function wizardSteps(isIngestion: boolean, template: ToolTemplate | null): WizardStep[] {
  if (isIngestion) return INGESTION_STEPS;
  const steps: WizardStep[] = [
    { id: "template", label: "Template", description: "The kind of tool to build." },
    { id: "basics", label: "Name", description: "What this pipeline is for." },
  ];
  // The blank scaffold has no store-bound node, so there's nothing to point
  // at an index — skip store selection and build it in the editor.
  if (template?.needs_store) {
    steps.push({ id: "store", label: "Vector store", description: "Where the data lives." });
  }
  if (template?.needs_embedding) {
    steps.push({ id: "model", label: "Embedding", description: "The model that embeds queries." });
  }
  if (template?.needs_reranker) {
    steps.push({
      id: "reranker",
      label: "Reranking",
      description: "The model that reorders results.",
    });
  }
  steps.push(REVIEW_STEP);
  return steps;
}
