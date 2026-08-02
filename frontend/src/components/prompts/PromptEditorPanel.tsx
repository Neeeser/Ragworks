"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { OutputFieldsEditor } from "@/components/pipelines/OutputFieldsEditor";
import { MessageStack } from "@/components/ui/message-stack";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Tooltip } from "@/components/ui/tooltip";

import { CONTEXT_ROLE_COPY, isNodeContext, SYSTEM_BODY_CONTEXTS } from "./lib/contexts";
import { contextTargets } from "./lib/targets";
import { TemplateEditor } from "./TemplateEditor";

import type { PromptDraft } from "./hooks/use-prompt-studio";
import type { TemplateEditorHandle } from "./TemplateEditor";
import type { StackMessage } from "@/components/ui/message-stack";
import type { PromptCatalog, PromptDetail, PromptRenderResult } from "@/lib/types";

interface PromptEditorPanelProps {
  detail: PromptDetail;
  draft: PromptDraft;
  onDraftChange: (draft: PromptDraft) => void;
  preview: PromptRenderResult | null;
  catalog: PromptCatalog | null;
}

/** The rendered preview as the message payload the templates become. */
function previewMessages(
  detail: PromptDetail,
  preview: PromptRenderResult | null,
  draft: PromptDraft,
): StackMessage[] {
  const copy = CONTEXT_ROLE_COPY[detail.context];
  if (isNodeContext(detail.context)) {
    const messages: StackMessage[] = [];
    const system = preview?.rendered_system ?? draft.systemBody;
    if (system) messages.push({ role: "system", content: system, note: copy.system?.hint });
    messages.push({ role: "user", content: preview?.rendered ?? draft.body, note: copy.body.hint });
    return messages;
  }
  return [{ role: "system", content: preview?.rendered ?? draft.body, note: copy.body.hint }];
}

/**
 * The template editor: markdown source with `{{variable}}` highlighting on
 * the left, the rendered message payload on the right, the context's
 * variable catalog and (for node contexts) the versioned output-field
 * schema underneath. Expandable to a full-screen editor.
 */
export function PromptEditorPanel({
  detail,
  draft,
  onDraftChange,
  preview,
  catalog,
}: PromptEditorPanelProps) {
  const bodyEditorRef = useRef<TemplateEditorHandle | null>(null);
  const [expanded, setExpanded] = useState(false);
  const overlayTitleId = useId();
  const hasSystemBody = SYSTEM_BODY_CONTEXTS.includes(detail.context);
  const copy = CONTEXT_ROLE_COPY[detail.context];
  const unknown = preview?.unknown_variables ?? [];

  const editorAndPreview = (
    <div className="flex flex-col gap-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-2">
      <div className="flex flex-col gap-2 lg:min-h-0">
        {hasSystemBody && copy.system && (
          <div className="flex shrink-0 flex-col gap-1">
            <span className="text-instrument font-medium text-muted">
              {copy.system.label}
              <span className="ml-2 font-normal text-meta">{copy.system.hint}</span>
            </span>
            <TemplateEditor
              ariaLabel={copy.system.label}
              value={draft.systemBody}
              onChange={(systemBody) => onDraftChange({ ...draft, systemBody })}
              placeholder="Optional instructions sent as the system role."
              className="min-h-[96px]"
            />
          </div>
        )}
        <div className="flex flex-col gap-1 lg:min-h-0 lg:flex-1">
          <span className="text-instrument font-medium text-muted">
            {copy.body.label}
            <span className="ml-2 font-normal text-meta">{copy.body.hint}</span>
          </span>
          <TemplateEditor
            ref={bodyEditorRef}
            ariaLabel={copy.body.label}
            value={draft.body}
            onChange={(body) => onDraftChange({ ...draft, body })}
            placeholder="Write the template. Use {{variable}} placeholders."
            className="min-h-[220px] lg:min-h-0 lg:flex-1"
            actions={
              <Tooltip content={expanded ? "Exit full screen" : "Edit full screen"}>
                <button
                  type="button"
                  aria-label={expanded ? "Exit full screen" : "Edit full screen"}
                  onClick={() => setExpanded((previous) => !previous)}
                  className="rounded-chip p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
                >
                  {expanded ? (
                    <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              </Tooltip>
            }
          />
        </div>
        {unknown.length > 0 && (
          <p className="shrink-0 text-instrument text-data-warn">
            Unknown in this context: {unknown.map((name) => `{{${name}}}`).join(", ")}
          </p>
        )}
      </div>

      <div className="flex flex-col lg:min-h-0 lg:overflow-y-auto">
        <MessageStack label="Rendered preview" messages={previewMessages(detail, preview, draft)} />
      </div>
    </div>
  );

  const catalogPanel = (
    <div className="shrink-0 space-y-1">
      <span className="text-instrument font-medium text-muted">Variables</span>
      <div className="max-h-40 divide-y divide-hairline overflow-y-auto rounded-control border border-hairline">
        {(catalog?.variables ?? []).map((variable) => (
          <button
            key={variable.name}
            type="button"
            className="w-full px-2 py-1.5 text-left transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
            onClick={() => bodyEditorRef.current?.insert(`{{${variable.name}}}`)}
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
  );

  const content = (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      {editorAndPreview}
      {catalogPanel}
      {isNodeContext(detail.context) && (
        <div className="shrink-0">
          <OutputFieldsEditor
            fields={draft.outputFields}
            targets={contextTargets(detail.context)}
            disabled={false}
            onChange={(outputFields) => onDraftChange({ ...draft, outputFields })}
          />
        </div>
      )}
    </div>
  );

  if (expanded) {
    return (
      <ModalOverlay open onClose={() => setExpanded(false)} labelledBy={overlayTitleId}>
        <div className="card-surface flex h-[92vh] w-[94vw] flex-col gap-3 bg-canvas-raised p-4 shadow-elevation-2">
          <h2
            id={overlayTitleId}
            className="shrink-0 text-head font-semibold tracking-[-0.01em] text-primary"
          >
            {detail.name}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-visible">{content}</div>
        </div>
      </ModalOverlay>
    );
  }
  return content;
}
