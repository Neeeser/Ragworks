"use client";

import { Check } from "lucide-react";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import { PIPELINE_TEMPLATES, type PipelineTemplate } from "./lib/pipeline-templates";

type WizardTemplateStepProps = {
  selectedId: string;
  onSelect: (template: PipelineTemplate) => void;
};

/** The tool-pipeline starting-point picker: search, reranked, count, or facet. */
export function WizardTemplateStep({ selectedId, onSelect }: WizardTemplateStepProps) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Pipeline template">
      <InstrumentLabel>Start from</InstrumentLabel>
      {PIPELINE_TEMPLATES.map((template) => {
        const active = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(template)}
            className={cn(
              "flex w-full items-start gap-3 rounded-control border p-3 text-left transition-colors duration-80 ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
              active
                ? "border-accent-violet/70 bg-accent-violet/10"
                : "border-hairline bg-surface hover:border-strong",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                active ? "border-accent-violet bg-accent-violet text-white" : "border-strong",
              )}
              aria-hidden
            >
              {active ? <Check className="h-2.5 w-2.5" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-ui font-medium text-primary">{template.label}</span>
              <span className="mt-0.5 block max-w-[66ch] text-ui leading-relaxed text-muted">
                {template.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
