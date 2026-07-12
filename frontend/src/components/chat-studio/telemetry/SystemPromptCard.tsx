"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { chipClass } from "@/components/chat-studio/lib/chat-constants";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";

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
    return <p className="text-sm text-muted">Loading prompt…</p>;
  }

  if (promptError) {
    return (
      <div className="rounded-2xl border border-data-neg/30 bg-data-neg/10 p-3 text-sm text-data-neg">
        {promptError}
      </div>
    );
  }

  const previewSource = promptPreviewMarkdown?.trim()
    ? promptPreviewMarkdown
    : "_No prompt content yet._";

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
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
      <div className="max-h-48 overflow-y-auto rounded-2xl border border-hairline bg-surface p-4 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {previewSource}
        </ReactMarkdown>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        {generatedAt && (
          <span>
            Generated{" "}
            <strong className="font-medium text-primary">{formatDateTime(generatedAt)}</strong>
          </span>
        )}
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onEdit}>
          Edit prompt
        </Button>
      </div>
    </div>
  );
};
