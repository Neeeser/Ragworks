"use client";

import { EditorView } from "@codemirror/view";
import { Bold, Code, Heading2, Italic, List } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  insertSnippet,
  replaceVariableAt,
  templateEditorExtensions,
  toggleInlineMarker,
  toggleLinePrefix,
  variableViewCompartment,
  variableViewExtension,
} from "./lib/codemirror";

import type { ChipTarget, VariableView } from "./lib/codemirror";
import type { ReactNode } from "react";

export interface TemplateEditorHandle {
  /** Insert text at the cursor — the variable catalog's click-to-insert. */
  insert: (text: string) => void;
  /** Point the reference at `pos` at a different variable. */
  replaceVariable: (pos: number, name: string) => void;
}

interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Whether `{{name}}` reads as itself or as its sample value. */
  view: VariableView;
  /** Sample value per variable, shown on the chips in `values` view. */
  values: Record<string, string>;
  /** A clicked value chip — the panel opens its editor over it. */
  onChipClick?: (target: ChipTarget) => void;
  /** Extra controls rendered at the toolbar's right edge (e.g. expand). */
  actions?: ReactNode;
  className?: string;
}

const TOOLBAR_BUTTONS: Array<{
  label: string;
  icon: typeof Bold;
  run: (view: EditorView) => void;
}> = [
  { label: "Bold", icon: Bold, run: (view) => toggleInlineMarker(view, "**") },
  { label: "Italic", icon: Italic, run: (view) => toggleInlineMarker(view, "*") },
  { label: "Inline code", icon: Code, run: (view) => toggleInlineMarker(view, "`") },
  { label: "Heading", icon: Heading2, run: (view) => toggleLinePrefix(view, "## ") },
  { label: "Bullet list", icon: List, run: (view) => toggleLinePrefix(view, "- ") },
];

/**
 * The markdown template editor: a CodeMirror source view with `{{variable}}`
 * highlighting, real undo/redo, and a formatting toolbar whose buttons write
 * markdown through the editor's transaction system (so they land on the same
 * undo history as typing).
 */
export const TemplateEditor = forwardRef<TemplateEditorHandle, TemplateEditorProps>(
  function TemplateEditor(
    { value, onChange, ariaLabel, placeholder, view, values, onChipClick, actions, className },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onChipClickRef = useRef(onChipClick);
    const initialValueRef = useRef(value);
    // Read at mount only; the compartment below carries every later change.
    const initialViewRef = useRef({ view, values });

    useEffect(() => {
      onChangeRef.current = onChange;
      onChipClickRef.current = onChipClick;
    }, [onChange, onChipClick]);

    useEffect(() => {
      if (!hostRef.current) return;
      const editor = new EditorView({
        doc: initialValueRef.current,
        parent: hostRef.current,
        extensions: templateEditorExtensions({
          ariaLabel,
          placeholder: placeholder ?? "",
          view: initialViewRef.current.view,
          values: initialViewRef.current.values,
          onDocChange: (doc) => onChangeRef.current(doc),
          onChipClick: (target) => onChipClickRef.current?.(target),
        }),
      });
      viewRef.current = editor;
      return () => {
        viewRef.current = null;
        editor.destroy();
      };
      // The view mounts once; label/placeholder changes remount it (they
      // only change when the edited prompt does, which replaces the doc too).
    }, [ariaLabel, placeholder]);

    // Swapping the decoration set through a compartment rather than
    // remounting keeps the undo history and the cursor across a view toggle.
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: variableViewCompartment.reconfigure(variableViewExtension(view, values)),
      });
    }, [view, values]);

    // External value changes (loading a version, switching prompts) replace
    // the doc; edits originating in the editor already match and are skipped.
    useEffect(() => {
      initialValueRef.current = value;
      const editor = viewRef.current;
      if (!editor) return;
      const current = editor.state.doc.toString();
      if (current !== value) {
        editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      }
    }, [value]);

    useImperativeHandle(ref, () => ({
      insert: (text: string) => {
        if (viewRef.current) insertSnippet(viewRef.current, text);
      },
      replaceVariable: (pos: number, name: string) => {
        if (viewRef.current) replaceVariableAt(viewRef.current, pos, name);
      },
    }));

    return (
      <div
        className={cn(
          "flex min-h-0 flex-col overflow-hidden rounded-control border border-hairline bg-surface",
          "focus-within:ring-2 focus-within:ring-accent-violet",
          className,
        )}
      >
        <div className="flex shrink-0 items-center gap-0.5 border-b border-hairline px-1 py-0.5">
          {TOOLBAR_BUTTONS.map(({ label, icon: Icon, run }) => (
            <Tooltip key={label} content={label}>
              <button
                type="button"
                aria-label={label}
                onClick={() => {
                  if (viewRef.current) run(viewRef.current);
                }}
                className="rounded-chip p-1 text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          ))}
          <div className="ml-auto flex items-center gap-0.5">{actions}</div>
        </div>
        <div ref={hostRef} className="min-h-0 flex-1 overflow-y-auto" />
      </div>
    );
  },
);
