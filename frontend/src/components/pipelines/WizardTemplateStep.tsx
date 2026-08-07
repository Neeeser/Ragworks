"use client";

import { Check } from "lucide-react";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import type { ToolTemplate } from "@/lib/types";

type WizardTemplateStepProps = {
  templates: ToolTemplate[];
  selectedId: string;
  loading: boolean;
  error: string | null;
  onSelect: (template: ToolTemplate) => void;
};

/** The tool-pipeline starting-point picker, rendered from the server's catalog. */
export function WizardTemplateStep({
  templates,
  selectedId,
  loading,
  error,
  onSelect,
}: WizardTemplateStepProps) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Pipeline template">
      <InstrumentLabel>Start from</InstrumentLabel>
      {error ? (
        <p className="rounded-control border border-data-warn/40 bg-data-warn/10 px-3 py-2 text-ui text-data-warn">
          {error}
        </p>
      ) : null}
      {loading && templates.length === 0 ? (
        <p className="text-ui text-muted">Loading templates…</p>
      ) : null}
      {templates.map((template) => {
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
