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
  replaceVariableAt,
  templateEditorExtensions,
  toggleInlineMarker,
  toggleLinePrefix,
  VARIABLE_ATTRIBUTE,
} from "../codemirror";

import type { VariableView } from "../codemirror";

let view: EditorView | null = null;

function makeView(
  doc: string,
  options: { view?: VariableView; values?: Record<string, string> } = {},
): EditorView {
  view = new EditorView({
    doc,
    parent: document.body,
    extensions: templateEditorExtensions({
      ariaLabel: "Template",
      placeholder: "",
      view: options.view ?? "names",
      values: options.values ?? {},
      onDocChange: () => {},
      onChipClick: () => {},
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

const CHIP_SELECTOR = `[${VARIABLE_ATTRIBUTE}]`;
const TEXT_TEMPLATE = "Rewrite {{text}}";

describe("the values view", () => {
  it("renders each variable as a chip showing its sample value", () => {
    const editor = makeView("Rewrite {{text}} for {{query}}.", {
      view: "values",
      values: { text: "carnitine and the heart", query: "cardiology" },
    });
    const chips = Array.from(editor.dom.querySelectorAll(CHIP_SELECTOR));
    expect(chips.map((chip) => chip.getAttribute(VARIABLE_ATTRIBUTE))).toEqual(["text", "query"]);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "carnitine and the heart",
      "cardiology",
    ]);
  });

  it("falls back to the variable's own name when no sample value is set", () => {
    const editor = makeView(TEXT_TEMPLATE, { view: "values", values: {} });
    const chip = editor.dom.querySelector(CHIP_SELECTOR);
    expect(chip?.textContent).toBe("{{text}}");
  });

  it("draws no chips in the names view", () => {
    const editor = makeView(TEXT_TEMPLATE, { view: "names", values: { text: "a query" } });
    expect(editor.dom.querySelector(CHIP_SELECTOR)).toBeNull();
  });

  it("swaps which variable a reference points at, and undo restores it", () => {
    const editor = makeView(`${TEXT_TEMPLATE} now`);
    // Position inside the reference, as a chip click reports it.
    replaceVariableAt(editor, 10, "query");
    expect(editor.state.doc.toString()).toBe("Rewrite {{query}} now");
    undo(editor);
    expect(editor.state.doc.toString()).toBe(`${TEXT_TEMPLATE} now`);
  });

  it("leaves the document alone when the position is not inside a reference", () => {
    const editor = makeView(`${TEXT_TEMPLATE} now`);
    replaceVariableAt(editor, 2, "query");
    expect(editor.state.doc.toString()).toBe(`${TEXT_TEMPLATE} now`);
  });
});
