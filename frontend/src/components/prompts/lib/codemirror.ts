/**
 * CodeMirror wiring for the template editor: console-token theme,
 * `{{variable}}` highlighting over markdown syntax, and the formatting
 * commands the toolbar dispatches. Everything goes through the view's
 * transaction system, so native-feeling undo/redo covers toolbar edits and
 * variable inserts as well as typing.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder as placeholderExtension,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import type { Extension } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

/** How `{{variable}}` reads: as its own name, or as its sample value. */
export type VariableView = "names" | "values";

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]*)\s*\}\}/g;

/** The attribute a chip carries so click handling can name its variable. */
export const VARIABLE_ATTRIBUTE = "data-template-variable";

/**
 * A variable rendered as its value.
 *
 * The widget *replaces* the `{{name}}` source, and the range is registered
 * atomic, so the cursor steps over it and backspace removes the whole
 * reference — a variable can never be left half-deleted by editing in this
 * view. The name rides along in a data attribute so a click can address it.
 */
class VariableChipWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly value: string,
  ) {
    super();
  }

  eq(other: VariableChipWidget): boolean {
    return other.name === this.name && other.value === this.value;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-template-chip";
    chip.setAttribute(VARIABLE_ATTRIBUTE, this.name);
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "-1");
    chip.title = `{{${this.name}}} — click to change the variable or its sample value`;
    chip.textContent = this.value === "" ? `{{${this.name}}}` : this.value;
    return chip;
  }

  /** Let clicks through to the view's own handler. */
  ignoreEvent(): boolean {
    return false;
  }
}

const nameMatcher = new MatchDecorator({
  regexp: VARIABLE_PATTERN,
  decoration: Decoration.mark({ class: "cm-template-variable" }),
});

function valueMatcher(values: Record<string, string>): MatchDecorator {
  return new MatchDecorator({
    regexp: VARIABLE_PATTERN,
    decoration: (match) => {
      const name = match[1];
      return Decoration.replace({ widget: new VariableChipWidget(name, values[name] ?? "") });
    },
  });
}

function decoratorPlugin(matcher: MatchDecorator) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }

      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    },
  );
}

/** Swapped at runtime so changing the view never remounts the editor. */
export const variableViewCompartment = new Compartment();

/** The decoration set for one view mode. */
export function variableViewExtension(
  view: VariableView,
  values: Record<string, string>,
): Extension {
  return view === "values" ? decoratorPlugin(valueMatcher(values)) : decoratorPlugin(nameMatcher);
}

/** One clicked variable chip: which variable, where in the doc, and where on screen. */
export interface ChipTarget {
  name: string;
  pos: number;
  rect: DOMRect;
}

/** Report clicks on a value chip. */
function chipClickHandler(onChipClick: (target: ChipTarget) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null;
      const chip = target?.closest?.(`[${VARIABLE_ATTRIBUTE}]`);
      if (!(chip instanceof HTMLElement)) return false;
      event.preventDefault();
      onChipClick({
        name: chip.getAttribute(VARIABLE_ATTRIBUTE) ?? "",
        pos: view.posAtDOM(chip),
        rect: chip.getBoundingClientRect(),
      });
      return true;
    },
  });
}

/**
 * Point the variable reference at `pos` to a different variable.
 *
 * Written as an ordinary transaction so the swap joins the undo history
 * alongside typing — a mis-click is one Cmd-Z away.
 */
export function replaceVariableAt(view: EditorView, pos: number, nextName: string): void {
  const doc = view.state.doc.toString();
  for (const match of doc.matchAll(VARIABLE_PATTERN)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (pos < from || pos > to) continue;
    view.dispatch({ changes: { from, to, insert: `{{${nextName}}}` } });
    return;
  }
}

const ACCENT = "var(--accent-violet)";
const INK_PRIMARY = "var(--text-primary)";

/** Accent wash at a given strength — the chip and selection share it. */
const accentWash = (percent: number) =>
  `color-mix(in oklab, ${ACCENT} ${percent}%, transparent)`;

const consoleTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--text-body)",
    fontSize: "12px",
  },
  ".cm-content": {
    fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
    caretColor: ACCENT,
    padding: "8px",
    lineHeight: "1.6",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: ACCENT },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: accentWash(22),
  },
  ".cm-placeholder": { color: "var(--text-faint)" },
  ".cm-template-variable": { color: ACCENT, fontWeight: "500" },
  ".cm-template-chip": {
    backgroundColor: accentWash(16),
    border: `1px solid ${accentWash(40)}`,
    borderRadius: "4px",
    color: INK_PRIMARY,
    cursor: "pointer",
    padding: "0 3px",
    whiteSpace: "pre-wrap",
  },
  ".cm-template-chip:hover": {
    backgroundColor: accentWash(26),
  },
});

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: INK_PRIMARY, fontWeight: "600" },
  { tag: tags.strong, color: INK_PRIMARY, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.monospace, color: "var(--accent-cyan)" },
  { tag: tags.link, color: "var(--accent-cyan)" },
  { tag: tags.quote, color: "var(--text-muted)" },
  { tag: tags.processingInstruction, color: "var(--text-meta)" },
]);

/** The extension set every template editor instance shares. */
export function templateEditorExtensions(options: {
  ariaLabel: string;
  placeholder: string;
  view: VariableView;
  values: Record<string, string>;
  onDocChange: (doc: string) => void;
  onChipClick: (target: ChipTarget) => void;
}): Extension[] {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown(),
    syntaxHighlighting(markdownHighlight),
    variableViewCompartment.of(variableViewExtension(options.view, options.values)),
    chipClickHandler(options.onChipClick),
    consoleTheme,
    EditorView.lineWrapping,
    placeholderExtension(options.placeholder),
    EditorView.contentAttributes.of({ "aria-label": options.ariaLabel }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChange(update.state.doc.toString());
    }),
  ];
}

/** Insert text at the cursor (replacing any selection), cursor after it. */
export function insertSnippet(view: EditorView, text: string): void {
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + text.length),
    })),
  );
  view.focus();
}

/** Toggle an inline marker (`**`, `*`, `` ` ``) around each selection. */
export function toggleInlineMarker(view: EditorView, marker: string): void {
  const length = marker.length;
  view.dispatch(
    view.state.changeByRange((range) => {
      const doc = view.state.doc;
      const before = doc.sliceString(Math.max(0, range.from - length), range.from);
      const after = doc.sliceString(range.to, Math.min(doc.length, range.to + length));
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - length, to: range.from },
            { from: range.to, to: range.to + length },
          ],
          range: EditorSelection.range(range.from - length, range.to - length),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + length, range.to + length),
      };
    }),
  );
  view.focus();
}

/** Toggle a line prefix (`## `, `- `) on every selected line. */
export function toggleLinePrefix(view: EditorView, prefix: string): void {
  const { state } = view;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      lines.add(line.number);
      if (line.to + 1 > range.to) break;
      pos = line.to + 1;
    }
  }
  const lineNumbers = [...lines].sort((a, b) => a - b);
  const allPrefixed = lineNumbers.every((number) => state.doc.line(number).text.startsWith(prefix));
  const changes = lineNumbers.map((number) => {
    const line = state.doc.line(number);
    return allPrefixed
      ? { from: line.from, to: line.from + prefix.length, insert: "" }
      : { from: line.from, insert: prefix };
  });
  view.dispatch({ changes });
  view.focus();
}
