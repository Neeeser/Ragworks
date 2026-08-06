"use client";

import { PresetCard } from "@/components/pipelines/PresetCard";
import { InstrumentLabel } from "@/components/ui/instrument-label";

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
    hint: "Render PDF pages as images and index them; uploaded image files pass through. Other content types are not read. Needs an image-capable embedding model, or a Describe node added in the editor.",
    nodes: "Render as Images · Media File · Resize Images",
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
        {INTAKE_PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            label={preset.label}
            hint={preset.hint}
            detail={preset.nodes}
            active={preset.id === value}
            onClick={() => onChange(preset.id)}
          />
        ))}
      </div>
    </div>
  );
}
