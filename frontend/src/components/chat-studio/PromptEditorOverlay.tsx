"use client";

import { X } from "lucide-react";
import { type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PromptDetails } from "@/lib/types";
import type { Components } from "react-markdown";

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
  markdownComponents: Components;
}

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
  markdownComponents,
}: PromptEditorOverlayProps) => {
  if (!isOpen || sections.length === 0) {
    return null;
  }

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];
  const variables = activeSection.details?.variables ?? [];
  const contextEntries = Object.entries(activeSection.details?.context ?? {});
  const previewSource = promptPreviewMarkdown?.trim() ? promptPreviewMarkdown : "_No content yet._";
  const headerLabel = activeSection.scope === "base" ? "Base prompt" : "Tool prompt";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex h-[85vh] w-full max-w-6xl flex-col rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">System prompt</p>
            <h2 className="text-2xl font-semibold text-white">Edit prompt sections</h2>
            <p className="text-sm text-slate-400">
              Tune the base instructions and tool snippets. The preview shows the full prompt that
              the model will see.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {sections.map((section) => {
            const isActive = section.id === activeSection.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onSelectSection(section.id)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-xs uppercase tracking-[0.3em] transition",
                  isActive
                    ? "border-violet-400 bg-violet-500/20 text-white"
                    : "border-white/10 bg-white/5 text-slate-400 hover:border-white/30 hover:text-white",
                )}
              >
                <span className="flex items-center gap-2">
                  {section.label}
                  {section.hasChanges && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="flex w-full flex-1 flex-col rounded-2xl border border-white/10 bg-black/30 p-4 lg:w-1/2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-white" htmlFor="system-prompt-editor">
                  {headerLabel} template
                </label>
                <button
                  type="button"
                  className="text-xs text-violet-300 hover:text-violet-200"
                  onClick={() => onReset(activeSection.id)}
                >
                  Revert to default
                </button>
              </div>
              <textarea
                id="system-prompt-editor"
                ref={inputRef}
                className="mt-3 min-h-[300px] flex-1 resize-none rounded-2xl border border-white/15 bg-black/60 px-4 py-3 font-mono text-sm text-white outline-none focus:border-violet-400"
                value={activeSection.draft}
                onChange={(event) => onDraftChange(activeSection.id, event.target.value)}
                placeholder="Write instructions with Markdown. Use {{variable}} placeholders."
              />
              <p className="mt-3 text-xs text-slate-500">
                Leave blank to fall back to the default prompt shipped with TransparentRAG.
              </p>
            </div>
            <div className="flex w-full flex-1 flex-col rounded-2xl border border-white/10 bg-black/30 p-4 lg:w-1/2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Rendered preview</p>
                <span className="text-xs text-slate-500">
                  {activeSection.details?.is_custom ? "Custom template" : "Default template"}
                </span>
              </div>
              <div className="mt-3 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {previewSource}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Variables</p>
              <p className="mt-1 text-xs text-slate-500">
                Click a variable to insert it at the cursor. Each one renders with current metadata.
              </p>
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                {variables.map((variable) => (
                  <button
                    key={variable.name}
                    type="button"
                    className="w-full rounded-2xl border border-white/5 bg-black/30 px-3 py-2 text-left transition hover:border-violet-400/60 hover:bg-black/60"
                    onClick={() => onInsertVariable(activeSection.id, variable.name)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <code className="rounded bg-white/10 px-2 py-0.5 text-[12px] text-violet-200">
                        {`{{${variable.name}}}`}
                      </code>
                      {variable.example && (
                        <span className="text-[11px] text-slate-500">
                          Example: <span className="text-slate-300">{variable.example}</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-300">{variable.description}</p>
                  </button>
                ))}
                {variables.length === 0 && (
                  <p className="text-sm text-slate-500">No template variables available.</p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                Example context
              </p>
              <div className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1 text-xs">
                {contextEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-3 border-b border-white/5 py-1 last:border-b-0"
                  >
                    <span className="truncate text-slate-500">{key}</span>
                    <span className="max-w-[60%] truncate text-right text-slate-200">{value}</span>
                  </div>
                ))}
                {contextEntries.length === 0 && (
                  <p className="text-slate-500">Context not available yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-white/5 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          {activeSection.error && <p className="text-sm text-rose-300">{activeSection.error}</p>}
          <div className="flex flex-1 justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => onSave(activeSection.id)}
              loading={activeSection.saving}
              disabled={!activeSection.hasChanges || activeSection.saving}
              className="px-5"
            >
              Save prompt
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
