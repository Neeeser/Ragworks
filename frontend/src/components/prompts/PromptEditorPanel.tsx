"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { OutputFieldsEditor } from "@/components/pipelines/OutputFieldsEditor";
import { MessageBody, MessageViewToggle, ROLE_INK } from "@/components/ui/message-stack";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { CONTEXT_ROLE_COPY, isNodeContext, SYSTEM_BODY_CONTEXTS } from "./lib/contexts";
import { contextTargets } from "./lib/targets";
import { TemplateEditor } from "./TemplateEditor";

import type { PromptDraft } from "./hooks/use-prompt-studio";
import type { TemplateEditorHandle } from "./TemplateEditor";
import type { MessageView, StackMessage } from "@/components/ui/message-stack";
import type { PromptCatalog, PromptDetail, PromptRenderResult } from "@/lib/types";
import type { ReactNode, Ref } from "react";

interface PromptEditorPanelProps {
  detail: PromptDetail;
  draft: PromptDraft;
  onDraftChange: (draft: PromptDraft) => void;
  preview: PromptRenderResult | null;
  catalog: PromptCatalog | null;
}

/** Label rows on both sides share a height, so the boxes below them align. */
const LABEL_ROW = "flex min-h-8 shrink-0 items-center gap-2";

interface TemplateRowProps {
  label: string;
  hint: string;
  role: StackMessage["role"];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rendered: string;
  view: MessageView;
  /** Rendered in the preview's label row — the shared view toggle. */
  viewControl?: ReactNode;
  editorActions?: ReactNode;
  editorRef?: Ref<TemplateEditorHandle>;
  editorClassName?: string;
}

/**
 * One template beside the message it becomes. The pair is a grid row, so
 * the editor and its rendering start on the same line and share a height —
 * a template and its output read as one thing, not two columns that happen
 * to sit near each other.
 */
function TemplateRow({
  label,
  hint,
  role,
  value,
  onChange,
  placeholder,
  rendered,
  view,
  viewControl,
  editorActions,
  editorRef,
  editorClassName,
}: TemplateRowProps) {
  return (
    <div className="grid gap-x-3 gap-y-2 lg:grid-cols-2">
      <div className="flex flex-col gap-1">
        <div className={LABEL_ROW}>
          <span className="shrink-0 whitespace-nowrap text-instrument font-medium text-primary">
            {label}
          </span>
          <span className="min-w-0 truncate text-instrument text-meta">{hint}</span>
        </div>
        <TemplateEditor
          ref={editorRef}
          ariaLabel={label}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          actions={editorActions}
          className={cn("min-h-[120px]", editorClassName)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className={cn(LABEL_ROW, "justify-between")}>
          <span className="flex items-baseline gap-2">
            <span className={cn("font-mono text-instrument", ROLE_INK[role])}>{role}</span>
            <span className="text-instrument text-meta">rendered</span>
          </span>
          {viewControl}
        </div>
        <MessageBody content={rendered} view={view} className="min-h-[120px] flex-1" />
      </div>
    </div>
  );
}

/** Toolbar control that swaps the editor between inline and full screen. */
function ExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const label = expanded ? "Exit full screen" : "Edit full screen";
  const Icon = expanded ? Minimize2 : Maximize2;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onToggle}
        className="rounded-chip p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

/** The context's variables; clicking one inserts it at the cursor. */
function VariableCatalog({
  catalog,
  onInsert,
}: {
  catalog: PromptCatalog | null;
  onInsert: (name: string) => void;
}) {
  return (
    <div className="shrink-0 space-y-1">
      <span className="text-instrument font-medium text-muted">Variables</span>
      <div className="max-h-40 divide-y divide-hairline overflow-y-auto rounded-control border border-hairline">
        {(catalog?.variables ?? []).map((variable) => (
          <button
            key={variable.name}
            type="button"
            className="w-full px-2 py-1.5 text-left transition-colors duration-80 ease-standard hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset"
            onClick={() => onInsert(variable.name)}
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
}

/**
 * The template editor: each template's markdown source beside the message
 * it renders into, the context's variable catalog underneath, and (for
 * node contexts) the versioned output-field schema. Expandable to a
 * full-screen editor.
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
  const [view, setView] = useState<MessageView>("rendered");
  const overlayTitleId = useId();
  const hasSystemBody = SYSTEM_BODY_CONTEXTS.includes(detail.context);
  const copy = CONTEXT_ROLE_COPY[detail.context];
  const unknown = preview?.unknown_variables ?? [];

  const toggle = <MessageViewToggle view={view} onChange={setView} label="Rendered preview view" />;

  const expandButton = (
    <ExpandButton expanded={expanded} onToggle={() => setExpanded((previous) => !previous)} />
  );

  const content = (
    <div className="flex flex-col gap-3">
      {hasSystemBody && copy.system && (
        <TemplateRow
          label={copy.system.label}
          hint={copy.system.hint}
          role="system"
          value={draft.systemBody}
          onChange={(systemBody) => onDraftChange({ ...draft, systemBody })}
          placeholder="Optional instructions sent as the system role."
          rendered={preview?.rendered_system ?? draft.systemBody}
          view={view}
          viewControl={toggle}
        />
      )}
      <TemplateRow
        label={copy.body.label}
        hint={copy.body.hint}
        role={hasSystemBody ? "user" : "system"}
        value={draft.body}
        onChange={(body) => onDraftChange({ ...draft, body })}
        placeholder="Write the template. Use {{variable}} placeholders."
        rendered={preview?.rendered ?? draft.body}
        view={view}
        viewControl={hasSystemBody ? undefined : toggle}
        editorActions={expandButton}
        editorRef={bodyEditorRef}
        editorClassName="min-h-[220px]"
      />
      {unknown.length > 0 && (
        <p className="shrink-0 text-instrument text-data-warn">
          Unknown in this context: {unknown.map((name) => `{{${name}}}`).join(", ")}
        </p>
      )}

      <VariableCatalog
        catalog={catalog}
        onInsert={(name) => bodyEditorRef.current?.insert(`{{${name}}}`)}
      />

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
