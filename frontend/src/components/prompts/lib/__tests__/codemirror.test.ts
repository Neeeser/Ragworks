/**
 * The template editor's edit commands. The load-bearing contract: every
 * programmatic edit (variable insert, toolbar formatting) goes through the
 * editor's transaction system, so undo restores it — replacing the whole
 * value from React state (the old textarea approach) killed the undo stack.
 */

import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  insertSnippet,
  templateEditorExtensions,
  toggleInlineMarker,
  toggleLinePrefix,
} from "../codemirror";

let view: EditorView | null = null;

function makeView(doc: string): EditorView {
  view = new EditorView({
    doc,
    parent: document.body,
    extensions: templateEditorExtensions({
      ariaLabel: "Template",
      placeholder: "",
      onDocChange: () => {},
    }),
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("template editor commands", () => {
  it("inserts a snippet at the cursor and undo removes it", () => {
    const editor = makeView("Hello ");
    editor.dispatch({ selection: { anchor: 6 } });
    insertSnippet(editor, "{{query}}");
    expect(editor.state.doc.toString()).toBe("Hello {{query}}");
    undo(editor);
    expect(editor.state.doc.toString()).toBe("Hello ");
  });

  it("wraps and unwraps an inline marker around the selection", () => {
    const editor = makeView("make this bold");
    editor.dispatch({ selection: { anchor: 5, head: 9 } });
    toggleInlineMarker(editor, "**");
    expect(editor.state.doc.toString()).toBe("make **this** bold");
    toggleInlineMarker(editor, "**");
    expect(editor.state.doc.toString()).toBe("make this bold");
  });

  it("toggles a line prefix across the selected lines", () => {
    const editor = makeView("one\ntwo");
    editor.dispatch({ selection: { anchor: 0, head: 7 } });
    toggleLinePrefix(editor, "- ");
    expect(editor.state.doc.toString()).toBe("- one\n- two");
    editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } });
    toggleLinePrefix(editor, "- ");
    expect(editor.state.doc.toString()).toBe("one\ntwo");
  });
});
