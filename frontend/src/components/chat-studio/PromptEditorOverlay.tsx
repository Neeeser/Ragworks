"use client";

import { X } from "lucide-react";
import { type RefObject, useId } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { inputClass } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Markdown } from "@/components/ui/markdown";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

import type { PromptDetails } from "@/lib/types";

type PromptEditorSection = {
  id: string;
  label: string;
  scope: "base" | "collection";
  details: PromptDetails | null;
  draft: string;
  hasChanges: boolean;
  saving: boolean;
  error: string | null;
};

interface PromptEditorOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  sections: PromptEditorSection[];
  activeSectionId: string | null;
  onSelectSection: (sectionId: string) => void;
  onDraftChange: (sectionId: string, value: string) => void;
  onSave: (sectionId: string) => void;
  onReset: (sectionId: string) => void;
  onInsertVariable: (sectionId: string, varName: string) => void;
  promptPreviewMarkdown: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The system-prompt editor: the template on the left, what the model will
 * actually see on the right, and the variables that can be dropped into it.
 *
 * The preview is the reason this is an overlay rather than a field in the run
 * settings pane — the assembled prompt needs the height to be read.
 */
export const PromptEditorOverlay = ({
  isOpen,
  onClose,
  sections,
  activeSectionId,
  onSelectSection,
  onDraftChange,
  onSave,
  onReset,
  onInsertVariable,
  promptPreviewMarkdown,
  inputRef,
}: PromptEditorOverlayProps) => {
  const titleId = useId();

  if (!isOpen || sections.length === 0) {
    return null;
  }

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];
  const variables = activeSection.details?.variables ?? [];
  const contextEntries = Object.entries(activeSection.details?.context ?? {});
  const previewSource = promptPreviewMarkdown?.trim() ? promptPreviewMarkdown : "_No content yet._";
  const headerLabel = activeSection.scope === "base" ? "Base prompt" : "Tool prompt";

  return (
    <ModalOverlay open onClose={onClose} labelledBy={titleId} backdropClassName="bg-canvas/80">
      <div className="card-surface flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden bg-canvas-raised shadow-elevation-2">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-hairline px-3">
          <h2
            id={titleId}
            className="truncate text-head font-semibold tracking-[-0.01em] text-primary"
          >
            Edit prompt sections
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClose}
            aria-label="Close prompt editor"
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

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="flex w-full flex-1 flex-col lg:w-1/2">
              <div className="flex items-center justify-between gap-2">
                <label
                  className="text-instrument font-medium text-muted"
                  htmlFor="system-prompt-editor"
                >
                  {headerLabel} template
                </label>
                <Button size="sm" variant="ghost" onClick={() => onReset(activeSection.id)}>
                  Revert to default
                </Button>
              </div>
              <textarea
                id="system-prompt-editor"
                ref={inputRef}
                className={cn(inputClass, "mt-1 min-h-[300px] flex-1 resize-none font-mono")}
                value={activeSection.draft}
                onChange={(event) => onDraftChange(activeSection.id, event.target.value)}
                placeholder="Write instructions with Markdown. Use {{variable}} placeholders."
              />
              <p className="mt-1 text-instrument text-meta">
                Left blank, the default prompt shipped with Ragworks applies.
              </p>
            </div>

            <div className="flex w-full flex-1 flex-col lg:w-1/2">
              <div className="flex items-center justify-between gap-2">
                <InstrumentLabel>Rendered preview</InstrumentLabel>
                <Chip tone={activeSection.details?.is_custom ? "accent" : "neutral"}>
                  {activeSection.details?.is_custom ? "Custom template" : "Default template"}
                </Chip>
              </div>
              <div className="mt-1 min-h-[300px] flex-1 overflow-y-auto rounded-control border border-hairline bg-surface p-2">
                <Markdown className="max-w-[66ch]">{previewSource}</Markdown>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
              <InstrumentLabel>Variables</InstrumentLabel>
              <p className="text-instrument text-meta">
                Each renders with the current session&apos;s metadata; clicking one inserts it at
                the cursor.
              </p>
              <div className="max-h-60 divide-y divide-hairline overflow-y-auto">
                {variables.map((variable) => (
                  <button
                    key={variable.name}
                    type="button"
                    className="w-full rounded-control px-2 py-1.5 text-left transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
                    onClick={() => onInsertVariable(activeSection.id, variable.name)}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <code className="font-mono text-instrument text-accent-violet">
                        {`{{${variable.name}}}`}
                      </code>
                      {variable.example && (
                        <span className="text-instrument text-meta">
                          Example: <span className="text-body">{variable.example}</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-ui text-body">{variable.description}</p>
                  </button>
                ))}
                {variables.length === 0 && (
                  <p className="py-1.5 text-ui text-muted">No template variables available.</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <InstrumentLabel>Example context</InstrumentLabel>
              <div className="max-h-32 divide-y divide-hairline overflow-y-auto">
                {contextEntries.map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3 py-1">
                    <span className="truncate text-instrument text-meta">{key}</span>
                    <span className="max-w-[60%] truncate text-right text-ui text-body">
                      {value}
                    </span>
                  </div>
                ))}
                {contextEntries.length === 0 && (
                  <p className="py-1.5 text-ui text-muted">Context not available yet.</p>
                )}
              </div>
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
              Save prompt
            </Button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
};
