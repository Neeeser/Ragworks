"use client";

import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CustomSelect } from "@/components/ui/custom-select";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Markdown } from "@/components/ui/markdown";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

import type {
  PromptChoice,
  PromptSection,
} from "@/components/chat-studio/hooks/settings/use-prompt-editor";
import type { PromptContext, PromptRead } from "@/lib/types";

interface PromptEditorOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  sections: PromptSection[];
  activeSectionId: string | null;
  libraryPrompts: PromptRead[];
  onSelectSection: (sectionId: string) => void;
  onChoice: (sectionId: string, choice: PromptChoice) => void;
  onSave: (sectionId: string) => void;
  promptPreviewMarkdown: string;
}

const SECTION_CONTEXT: Record<PromptSection["scope"], PromptContext> = {
  base: "chat.base",
  collection: "chat.tool",
};

/**
 * The chat prompt picker: each section references a library prompt with a
 * Docker-tag style version pin, previewed in place. Editing bodies happens in
 * the Prompts studio — this overlay only chooses which prompt and version a
 * section runs.
 */
export const PromptEditorOverlay = ({
  isOpen,
  onClose,
  sections,
  activeSectionId,
  libraryPrompts,
  onSelectSection,
  onChoice,
  onSave,
  promptPreviewMarkdown,
}: PromptEditorOverlayProps) => {
  const titleId = useId();

  if (!isOpen || sections.length === 0) {
    return null;
  }

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];
  const contextForSection = SECTION_CONTEXT[activeSection.scope];
  const candidates = libraryPrompts.filter((prompt) => prompt.context === contextForSection);
  const chosen = activeSection.choice;
  const chosenPrompt = candidates.find((prompt) => prompt.id === chosen?.promptId) ?? null;
  const maxVersion =
    chosenPrompt?.current_version ?? activeSection.selection?.prompt?.current_version ?? 1;
  const versionOptions = [
    { value: "latest", label: `latest (v${maxVersion})` },
    ...Array.from({ length: maxVersion }, (_, index) => maxVersion - index).map((version) => ({
      value: String(version),
      label: `v${version}`,
    })),
  ];
  const previewSource = promptPreviewMarkdown?.trim() ? promptPreviewMarkdown : "_No content yet._";

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId} backdropClassName="bg-canvas/80">
      <div className="card-surface flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden bg-canvas-raised shadow-elevation-2">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-3">
          <h2
            id={titleId}
            className="truncate text-head font-semibold tracking-[-0.01em] text-primary"
          >
            System prompt
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClose}
            aria-label="Close prompt picker"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1 border-b border-hairline px-3 py-2">
          {sections.map((section) => {
            const isActive = section.id === activeSection.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelectSection(section.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-control px-2 py-1 text-ui",
                  "transition-colors duration-80 ease-standard focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-accent-violet",
                  isActive
                    ? "bg-accent-violet/12 font-medium text-primary"
                    : "text-muted hover:bg-surface hover:text-primary",
                )}
              >
                {section.label}
                {section.hasChanges && (
                  <span
                    aria-label="Unsaved changes"
                    className="h-1.5 w-1.5 rounded-[2px] bg-data-warn"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row">
          <div className="flex w-full flex-col gap-3 lg:w-[40%]">
            <div className="space-y-1">
              <InstrumentLabel>Prompt</InstrumentLabel>
              <CustomSelect
                aria-label="Prompt"
                value={chosen?.promptId ?? ""}
                placeholder="Pick a prompt"
                options={candidates.map((prompt) => ({
                  value: prompt.id,
                  label: prompt.name,
                }))}
                onValueChange={(promptId) =>
                  onChoice(activeSection.id, { promptId, version: "latest" })
                }
              />
            </div>
            <div className="space-y-1">
              <InstrumentLabel>Version</InstrumentLabel>
              <CustomSelect
                aria-label="Version"
                value={chosen ? String(chosen.version) : "latest"}
                placeholder="latest"
                disabled={!chosen}
                options={versionOptions}
                onValueChange={(value) =>
                  chosen &&
                  onChoice(activeSection.id, {
                    promptId: chosen.promptId,
                    version: value === "latest" ? "latest" : Number(value),
                  })
                }
              />
            </div>
            {chosenPrompt && (
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={chosenPrompt.source === "shipped" ? "neutral" : "accent"}>
                  {chosenPrompt.source === "shipped" ? "Shipped" : "Yours"}
                </Chip>
                <Link
                  href={`/prompts?prompt=${chosenPrompt.id}`}
                  className="inline-flex items-center gap-1 text-instrument text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  Edit in prompt studio
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-1">
              <InstrumentLabel>Template</InstrumentLabel>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-control border border-hairline bg-surface p-2 font-mono text-instrument text-body">
                {activeSection.choiceBody || "No template selected."}
              </pre>
            </div>
          </div>

          <div className="flex w-full min-h-0 flex-1 flex-col lg:w-[60%]">
            <InstrumentLabel>Rendered preview</InstrumentLabel>
            <div className="mt-1 min-h-[300px] flex-1 overflow-y-auto rounded-control border border-hairline bg-surface p-2">
              <Markdown className="max-w-[66ch]">{previewSource}</Markdown>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-3 py-2">
          {activeSection.error && (
            <p className="min-w-0 text-ui text-data-neg">{activeSection.error}</p>
          )}
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              glow
              onClick={() => onSave(activeSection.id)}
              loading={activeSection.saving}
              disabled={!activeSection.hasChanges || activeSection.saving}
            >
              Use this prompt
            </Button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
};
