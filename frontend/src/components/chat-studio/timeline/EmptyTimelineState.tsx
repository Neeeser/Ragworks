import { InstrumentLabel } from "@/components/ui/instrument-label";

interface EmptyTimelineStateProps {
  overrideSections: Array<{ id: string; label: string }>;
  onOverrideSelect: (sectionId: string) => void;
}

/**
 * The studio before a session exists.
 *
 * One line about what starts a chat, plus the run settings that already differ
 * from their defaults — the only thing here the user cannot see anywhere else on
 * screen, and each one a shortcut to the section that owns it.
 */
export const EmptyTimelineState = ({
  overrideSections,
  onOverrideSelect,
}: EmptyTimelineStateProps) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
    <p className="max-w-[66ch] text-ui text-muted">Sending the first message starts a new chat.</p>
    {overrideSections.length > 0 && (
      <div className="flex flex-col items-center gap-1.5">
        <InstrumentLabel>Active run settings</InstrumentLabel>
        <div className="flex flex-wrap justify-center gap-1.5">
          {overrideSections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onOverrideSelect(section.id)}
              className="rounded-full bg-accent-violet/12 px-2 py-0.5 text-instrument font-medium text-accent-violet transition-colors duration-80 ease-standard hover:bg-accent-violet/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
);
