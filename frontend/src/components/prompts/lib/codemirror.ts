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
import { EditorSelection } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder as placeholderExtension,
  ViewPlugin,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import type { Extension } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

const variableMatcher = new MatchDecorator({
  regexp: /\{\{\s*[a-zA-Z0-9_][a-zA-Z0-9_.-]*\s*\}\}/g,
  decoration: Decoration.mark({ class: "cm-template-variable" }),
});

const variableHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = variableMatcher.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = variableMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const ACCENT = "var(--accent-violet)";

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
    backgroundColor: `color-mix(in oklab, ${ACCENT} 22%, transparent)`,
  },
  ".cm-placeholder": { color: "var(--text-faint)" },
  ".cm-template-variable": { color: ACCENT, fontWeight: "500" },
});

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.strong, color: "var(--text-primary)", fontWeight: "600" },
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
  onDocChange: (doc: string) => void;
}): Extension[] {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown(),
    syntaxHighlighting(markdownHighlight),
    variableHighlighter,
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
