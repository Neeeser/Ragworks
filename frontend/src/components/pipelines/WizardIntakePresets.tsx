"use client";

import { InstrumentLabel } from "@/components/ui/instrument-label";
import { cn } from "@/lib/utils";

import type { IntakeMode } from "@/components/pipelines/lib/pipeline-scaffold";

export type IntakePreset = {
  id: IntakeMode;
  label: string;
  hint: string;
  /** The parse nodes this mode wires, named as the graph will show them. */
  nodes: string;
};

export const INTAKE_PRESETS: IntakePreset[] = [
  {
    id: "text",
    label: "Text documents",
    hint: "Extract each file's text and chunk it.",
    nodes: "Extract Text",
  },
  {
    id: "text_images",
    label: "Text + images",
    hint: "Also index images found in documents and uploaded images. Needs an image-capable embedding model, or a Describe node added in the editor.",
    nodes: "Extract Text · Extract Media · Media File",
  },
  {
    id: "images",
    label: "Everything as images",
    hint: "Render every page as an image and index it. Needs an image-capable embedding model, or a Describe node added in the editor.",
    nodes: "Render as Images · Media File",
  },
];

type IntakePresetsProps = {
  value: IntakeMode;
  onChange: (mode: IntakeMode) => void;
};

/** The intake preset segment: which parse nodes an ingestion scaffold wires. */
export function WizardIntakePresets({ value, onChange }: IntakePresetsProps) {
  return (
    <div>
      <InstrumentLabel>Intake</InstrumentLabel>
      <p className="mt-0.5 max-w-[66ch] text-ui text-muted">
        What the pipeline reads out of an uploaded file. Each parse node handles the content types
        it has a handler for; the rest of the graph is the same.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Intake preset">
        {INTAKE_PRESETS.map((preset) => {
          const active = preset.id === value;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(preset.id)}
              className={cn(
                "rounded-control border p-3 text-left transition-colors duration-80 ease-standard",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                active
                  ? "border-accent-violet/70 bg-accent-violet/10"
                  : "border-hairline bg-surface hover:border-strong",
              )}
            >
              <p className="text-ui font-medium text-primary">{preset.label}</p>
              <p className="mt-0.5 text-instrument leading-4 text-muted">{preset.hint}</p>
              <p className="mt-1 font-mono text-instrument text-meta">{preset.nodes}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
