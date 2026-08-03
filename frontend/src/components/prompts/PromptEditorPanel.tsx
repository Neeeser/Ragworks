"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { OutputFieldsEditor } from "@/components/pipelines/OutputFieldsEditor";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { CONTEXT_ROLE_COPY, isNodeContext, SYSTEM_BODY_CONTEXTS } from "./lib/contexts";
import { contextTargets } from "./lib/targets";
import { PromptVariables } from "./PromptVariables";
import { TemplateEditor } from "./TemplateEditor";
import { VariableChipPopover } from "./VariableChipPopover";

import type { PromptDraft } from "./hooks/use-prompt-studio";
import type { ChipTarget, VariableView } from "./lib/codemirror";
import type { TemplateEditorHandle } from "./TemplateEditor";
import type { PromptCatalog, PromptDetail, PromptRenderResult } from "@/lib/types";
import type { ReactNode, Ref } from "react";

interface PromptEditorPanelProps {
  detail: PromptDetail;
  draft: PromptDraft;
  onDraftChange: (draft: PromptDraft) => void;
  preview: PromptRenderResult | null;
  catalog: PromptCatalog | null;
}

const VIEW_OPTIONS: Array<{ id: VariableView; label: string }> = [
  { id: "names", label: "Names" },
  { id: "values", label: "Values" },
];

interface TemplateFieldProps {
  label: string;
  hint: string;
  role: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  view: VariableView;
  values: Record<string, string>;
  onChipClick: (target: ChipTarget) => void;
  editorActions?: ReactNode;
  editorRef?: Ref<TemplateEditorHandle>;
  editorClassName?: string;
}

/**
 * One template, at the panel's full width.
 *
 * There is deliberately no preview column beside it: the two would differ
 * only where a variable appears, and the `values` view already shows that
 * difference in place. The exact message payload — roles, markdown, what
 * actually goes on the wire — belongs to the Test tab, which sends it.
 */
function TemplateField({
  label,
  hint,
  role,
  value,
  onChange,
  placeholder,
  view,
  values,
  onChipClick,
  editorActions,
  editorRef,
  editorClassName,
}: TemplateFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-6 flex-wrap items-baseline gap-2">
        <span className="shrink-0 text-instrument font-medium text-primary">{label}</span>
        <span className="font-mono text-instrument text-accent-violet">{role}</span>
        <span className="min-w-0 text-instrument text-meta">{hint}</span>
      </div>
      <TemplateEditor
        ref={editorRef}
        ariaLabel={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        view={view}
        values={values}
        onChipClick={onChipClick}
        actions={editorActions}
        className={cn("min-h-[120px]", editorClassName)}
      />
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

/**
 * The template editor: each template at full width, with `{{variable}}`
 * readable either as its own name or as the sample value it will render
 * to, the context's variables and their sample values underneath, and
 * (for node contexts) the versioned output-field schema.
 */
export function PromptEditorPanel({
  detail,
  draft,
  onDraftChange,
  preview,
  catalog,
}: PromptEditorPanelProps) {
  const bodyEditorRef = useRef<TemplateEditorHandle | null>(null);
  const systemEditorRef = useRef<TemplateEditorHandle | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<VariableView>("names");
  const [chip, setChip] = useState<{ target: ChipTarget; field: "body" | "system" } | null>(null);
  const overlayTitleId = useId();
  const hasSystemBody = SYSTEM_BODY_CONTEXTS.includes(detail.context);
  const copy = CONTEXT_ROLE_COPY[detail.context];
  const unknown = preview?.unknown_variables ?? [];
  // The server echoes the values it rendered with — catalog examples
  // overlaid with whatever the user typed — so unset variables still show
  // a real value on their chips.
  const values = { ...(preview?.values ?? {}), ...draft.values };

  const setValue = (name: string, value: string) =>
    onDraftChange({ ...draft, values: { ...draft.values, [name]: value } });

  const expandButton = (
    <ExpandButton expanded={expanded} onToggle={() => setExpanded((previous) => !previous)} />
  );

  const content = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-instrument text-meta">
          {view === "names"
            ? "Variables shown by name."
            : "Variables shown as their sample values — click one to change it."}
        </span>
        <SegmentedControl<VariableView>
          aria-label="Variable view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
        />
      </div>
      {hasSystemBody && copy.system && (
        <TemplateField
          label={copy.system.label}
          hint={copy.system.hint}
          role="system"
          value={draft.systemBody}
          onChange={(systemBody) => onDraftChange({ ...draft, systemBody })}
          placeholder="Optional instructions sent as the system role."
          view={view}
          values={values}
          onChipClick={(target) => setChip({ target, field: "system" })}
          editorRef={systemEditorRef}
        />
      )}
      <TemplateField
        label={copy.body.label}
        hint={copy.body.hint}
        role={hasSystemBody ? "user" : "system"}
        value={draft.body}
        onChange={(body) => onDraftChange({ ...draft, body })}
        placeholder="Write the template. Use {{variable}} placeholders."
        view={view}
        values={values}
        onChipClick={(target) => setChip({ target, field: "body" })}
        editorActions={expandButton}
        editorRef={bodyEditorRef}
        editorClassName="min-h-[260px]"
      />
      {unknown.length > 0 && (
        <p className="shrink-0 text-instrument text-data-warn">
          Unknown in this context: {unknown.map((name) => `{{${name}}}`).join(", ")}
        </p>
      )}

      <PromptVariables
        catalog={catalog}
        values={values}
        onValueChange={setValue}
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

      {chip && (
        <VariableChipPopover
          target={chip.target}
          catalog={catalog}
          value={values[chip.target.name] ?? ""}
          onValueChange={(next) => setValue(chip.target.name, next)}
          onSwap={(name) => {
            const editor = chip.field === "system" ? systemEditorRef : bodyEditorRef;
            editor.current?.replaceVariable(chip.target.pos, name);
            setChip(null);
          }}
          onClose={() => setChip(null)}
        />
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
          <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
        </div>
      </ModalOverlay>
    );
  }
  return content;
}
