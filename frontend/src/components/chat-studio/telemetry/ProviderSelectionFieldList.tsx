"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";

import { InstrumentLabel } from "@/components/ui/instrument-label";

interface ProviderSelectionFieldListProps {
  label: string;
  fieldKey: string;
  values: string[];
  showIndex?: boolean;
  allowReorder?: boolean;
  onRemove: (slug: string) => void;
  onMove: (slug: string, delta: number) => void;
}

const iconButtonClass =
  "rounded-control p-0.5 text-muted transition-colors duration-80 ease-standard hover:text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet";

/** One selection list (order / allow-only / ignore) as removable slug pills. */
export const ProviderSelectionFieldList = ({
  label,
  fieldKey,
  values,
  showIndex,
  allowReorder,
  onRemove,
  onMove,
}: ProviderSelectionFieldListProps) => {
  return (
    <div className="space-y-1" key={fieldKey}>
      <div className="flex items-baseline gap-2">
        <InstrumentLabel>{label}</InstrumentLabel>
        {values.length === 0 && <span className="text-instrument text-meta">None selected</span>}
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((slug, index) => (
            <div
              key={`${fieldKey}-${slug}`}
              className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5"
            >
              {showIndex && (
                <span className="font-mono text-instrument tabular-nums text-meta">
                  {index + 1}
                </span>
              )}
              <span className="font-mono text-instrument text-primary">{slug}</span>
              {allowReorder && values.length > 1 && (
                <>
                  <button
                    type="button"
                    className={iconButtonClass}
                    onClick={() => onMove(slug, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${slug} earlier`}
                  >
                    <ArrowUp className="h-3 w-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={iconButtonClass}
                    onClick={() => onMove(slug, 1)}
                    disabled={index === values.length - 1}
                    aria-label={`Move ${slug} later`}
                  >
                    <ArrowDown className="h-3 w-3" aria-hidden />
                  </button>
                </>
              )}
              <button
                type="button"
                className={iconButtonClass}
                onClick={() => onRemove(slug)}
                aria-label={`Remove ${slug}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
