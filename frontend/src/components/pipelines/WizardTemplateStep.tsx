"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { PIPELINE_TEMPLATES, type PipelineTemplate } from "./lib/pipeline-templates";

type WizardTemplateStepProps = {
  selectedId: string;
  onSelect: (template: PipelineTemplate) => void;
};

/** The tool-pipeline starting-point picker: search, reranked, count, or facet. */
export function WizardTemplateStep({ selectedId, onSelect }: WizardTemplateStepProps) {
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Pipeline template">
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Start from</p>
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
              "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition",
              active
                ? "border-accent-violet/70 bg-accent-violet/10"
                : "border-hairline bg-surface hover:border-strong",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                active ? "border-accent-violet bg-accent-violet text-white" : "border-strong",
              )}
              aria-hidden
            >
              {active ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-primary">{template.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                {template.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
