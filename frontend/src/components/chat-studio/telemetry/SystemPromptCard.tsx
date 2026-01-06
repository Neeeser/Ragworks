"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";

import type { Components } from "react-markdown";

interface PromptSectionSummary {
  id: string;
  label: string;
  scope: "base" | "collection";
  isCustom: boolean;
}

interface SystemPromptCardProps {
  promptPreviewMarkdown: string;
  promptSections: PromptSectionSummary[];
  promptLoading: boolean;
  promptError: string | null;
  generatedAt?: string | null;
  onEdit: () => void;
  markdownComponents: Components;
}

export const SystemPromptCard = ({
  promptPreviewMarkdown,
  promptSections,
  promptLoading,
  promptError,
  generatedAt,
  onEdit,
  markdownComponents,
}: SystemPromptCardProps) => {
  if (promptLoading) {
    return <p className="text-sm text-slate-400">Loading prompt…</p>;
  }

  if (promptError) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
        {promptError}
      </div>
    );
  }

  const previewSource = promptPreviewMarkdown?.trim()
    ? promptPreviewMarkdown
    : "_No prompt content yet._";
  const chipClass =
    "rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-slate-300";

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Prompt combines your base instructions with each enabled tool snippet. Use the editor to
        adjust the base template and per-tool prompt blocks.
      </p>
      <div className="flex flex-wrap gap-2">
        {promptSections.map((section) => (
          <span key={section.id} className={chipClass}>
            {section.scope === "base" ? "Base prompt" : section.label}
            {section.isCustom ? " · Custom" : ""}
          </span>
        ))}
      </div>
      <div className="max-h-48 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {previewSource}
        </ReactMarkdown>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        {generatedAt && (
          <span>
            Generated at <strong className="text-white">{generatedAt}</strong>
          </span>
        )}
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onEdit}>
          Edit prompt
        </Button>
      </div>
    </div>
  );
};
