import { TELEMETRY_SECTION_IDS } from "@/components/chat-studio/lib/chat-constants";
import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";

interface EmptyTimelineStateProps {
  overrideSections: Array<{ id: string; label: string }>;
  onOverrideSelect: (sectionId: string) => void;
  /** No chat model is selected, so a message sent from here has nothing to run on. */
  needsChatModel: boolean;
}

/**
 * The studio before a session exists.
 *
 * One line about what starts a chat, plus the run settings that already differ
 * from their defaults — the only thing here the user cannot see anywhere else on
 * screen, and each one a shortcut to the section that owns it.
 *
 * With no model selected the line states the constraint instead, and carries the
 * action that resolves it: the model picker lives inside a pane that starts
 * closed, so without this the requirement is only discoverable by guessing.
 * This button is the view's one glowing action — the top bar has no primary.
 */
export const EmptyTimelineState = ({
  overrideSections,
  onOverrideSelect,
  needsChatModel,
}: EmptyTimelineStateProps) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
    <p className="max-w-[66ch] text-ui text-muted">
      {needsChatModel
        ? "Sending a message requires a chat model."
        : "Sending the first message starts a new chat."}
    </p>
    {needsChatModel && (
      <Button size="sm" glow onClick={() => onOverrideSelect(TELEMETRY_SECTION_IDS.modelRouting)}>
        Select model
      </Button>
    )}
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
