"use client";

import { useRef } from "react";

import { inputClass } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

import { SYSTEM_BODY_CONTEXTS } from "./lib/contexts";

import type { PromptDraft } from "./hooks/use-prompt-studio";
import type { PromptCatalog, PromptDetail, PromptRenderResult } from "@/lib/types";

interface PromptEditorPanelProps {
  detail: PromptDetail;
  draft: PromptDraft;
  onDraftChange: (draft: PromptDraft) => void;
  preview: PromptRenderResult | null;
  catalog: PromptCatalog | null;
}

/**
 * The template editor: draft on the left, server-rendered preview with
 * strict-validation findings on the right, the context's variable catalog
 * underneath (click to insert at the cursor).
 */
export function PromptEditorPanel({
  detail,
  draft,
  onDraftChange,
  preview,
  catalog,
}: PromptEditorPanelProps) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const hasSystemBody = SYSTEM_BODY_CONTEXTS.includes(detail.context);
  const unknown = preview?.unknown_variables ?? [];

  const insertVariable = (name: string) => {
    const insertion = `{{${name}}}`;
    const textarea = bodyRef.current;
    const current = draft.body;
    if (!textarea) {
      onDraftChange({ ...draft, body: `${current}${current ? " " : ""}${insertion}` });
      return;
    }
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    onDraftChange({
      ...draft,
      body: current.slice(0, start) + insertion + current.slice(end),
    });
    window.requestAnimationFrame(() => {
      const cursor = start + insertion.length;
      textarea.selectionStart = cursor;
      textarea.selectionEnd = cursor;
      textarea.focus();
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-2">
          {hasSystemBody && (
            <div className="flex flex-col gap-1">
              <label
                className="text-instrument font-medium text-muted"
                htmlFor="prompt-system-body"
              >
                System template
              </label>
              <textarea
                id="prompt-system-body"
                className={cn(inputClass, "min-h-[72px] resize-y font-mono")}
                value={draft.systemBody}
                onChange={(event) => onDraftChange({ ...draft, systemBody: event.target.value })}
                placeholder="Optional system message."
              />
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <label className="text-instrument font-medium text-muted" htmlFor="prompt-body">
              Template
            </label>
            <textarea
              id="prompt-body"
              ref={bodyRef}
              className={cn(inputClass, "min-h-[240px] flex-1 resize-none font-mono")}
              value={draft.body}
              onChange={(event) => onDraftChange({ ...draft, body: event.target.value })}
              placeholder="Write instructions. Use {{variable}} placeholders."
            />
          </div>
          {unknown.length > 0 && (
            <p className="text-instrument text-data-warn">
              Unknown in this context: {unknown.map((name) => `{{${name}}}`).join(", ")}
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-1">
          <InstrumentLabel>Rendered preview</InstrumentLabel>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-control border border-hairline bg-surface p-2">
            {preview?.rendered_system && (
              <pre className="mb-2 whitespace-pre-wrap border-b border-hairline pb-2 font-mono text-instrument text-muted">
                {preview.rendered_system}
              </pre>
            )}
            <Markdown className="max-w-[66ch]">{preview?.rendered ?? draft.body}</Markdown>
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-1">
        <InstrumentLabel>Variables</InstrumentLabel>
        <div className="max-h-40 divide-y divide-hairline overflow-y-auto rounded-control border border-hairline">
          {(catalog?.variables ?? []).map((variable) => (
            <button
              key={variable.name}
              type="button"
              className="w-full px-2 py-1.5 text-left transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
              onClick={() => insertVariable(variable.name)}
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
          {(catalog?.namespaces ?? []).map((namespace) => (
            <div key={namespace.prefix} className="px-2 py-1.5">
              <code className="font-mono text-instrument text-accent-violet">
                {`{{${namespace.prefix}.<key>}}`}
              </code>
              <p className="mt-0.5 text-ui text-body">{namespace.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
