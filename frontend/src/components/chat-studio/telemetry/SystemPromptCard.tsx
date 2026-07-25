"use client";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Markdown } from "@/components/ui/markdown";
import { formatDateTime } from "@/lib/datetime";

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
}

/** The prompt the model will see, assembled from the base template and each
 *  enabled tool's snippet. */
export const SystemPromptCard = ({
  promptPreviewMarkdown,
  promptSections,
  promptLoading,
  promptError,
  generatedAt,
  onEdit,
}: SystemPromptCardProps) => {
  if (promptLoading) {
    return <p className="text-ui text-muted">Loading prompt…</p>;
  }

  if (promptError) {
    return <p className="text-ui text-data-neg">{promptError}</p>;
  }

  const previewSource = promptPreviewMarkdown?.trim()
    ? promptPreviewMarkdown
    : "_No prompt content yet._";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {promptSections.map((section) => (
          <Chip key={section.id} tone={section.isCustom ? "accent" : "neutral"}>
            {`${section.scope === "base" ? "Base prompt" : section.label}${
              section.isCustom ? " · Custom" : ""
            }`}
          </Chip>
        ))}
      </div>
      <div className="max-h-48 overflow-y-auto rounded-control border border-hairline bg-surface-strong p-2">
        <Markdown className="max-w-[66ch]">{previewSource}</Markdown>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {generatedAt && (
          <span className="text-instrument text-meta">
            Generated{" "}
            <span className="font-mono tabular-nums text-body">{formatDateTime(generatedAt)}</span>
          </span>
        )}
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onEdit}>
          Edit prompt
        </Button>
      </div>
    </div>
  );
};
