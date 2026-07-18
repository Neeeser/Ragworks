import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VariablesPanel } from "../VariablesPanel";

import type { PipelineVariable } from "@/lib/types";

const TOP_K: PipelineVariable = {
  name: "top_k",
  type: "integer",
  source: "input",
  value: 5,
};

const INPUT_NODE = {
  type: "retrieval.input",
  config: {
    arguments: ["top_k"],
  },
};

const renderPanel = (
  variables: PipelineVariable[],
  onChange = vi.fn(),
  nodes: Array<{ type: string; config: Record<string, unknown> }> = [INPUT_NODE],
) => {
  render(
    <VariablesPanel
      variables={variables}
      onChange={onChange}
      nodes={nodes}
      modelOptions={[]}
      disabled={false}
    />,
  );
  return onChange;
};

describe("VariablesPanel", () => {
  it("shows an input variable with its badge and accepted-by reference", async () => {
    renderPanel([TOP_K]);
    expect(screen.getByText("top_k")).toBeInTheDocument();
    expect(screen.getByText("input")).toBeInTheDocument();
    await userEvent.click(screen.getByText("top_k"));
    expect(screen.getByText(/Used by the retrieval input node/)).toBeInTheDocument();
  });

  it("edits an input variable's caller contract in place", async () => {
    const onChange = renderPanel([TOP_K]);
    await userEvent.click(screen.getByText("top_k"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Expose to model" }));
    const next = onChange.mock.calls.at(-1)?.[0] as PipelineVariable[];
    expect(next[0].expose_to_llm).toBe(true);
  });

  it.each(["string", "boolean", "enum"] as const)(
    "makes a new %s input required instead of installing a default",
    async (type) => {
      const onChange = renderPanel([
        {
          name: "required_value",
          type,
          source: "value",
          value: type === "boolean" ? false : type === "enum" ? "focused" : "text",
          choices: type === "enum" ? ["focused", "broad"] : undefined,
        },
      ]);
      await userEvent.click(screen.getByText("required_value"));
      await userEvent.click(screen.getByRole("combobox", { name: "Source" }));
      await userEvent.click(screen.getByRole("option", { name: "Input" }));

      const next = onChange.mock.calls.at(-1)?.[0] as PipelineVariable[];
      expect(next[0].source).toBe("input");
      expect(next[0].value).toBeNull();
    },
  );

  it("keeps an input required when its type changes", async () => {
    const onChange = renderPanel([
      { name: "required_value", type: "integer", source: "input", value: null },
    ]);
    await userEvent.click(screen.getByText("required_value"));
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(screen.getByRole("option", { name: "String" }));

    const next = onChange.mock.calls.at(-1)?.[0] as PipelineVariable[];
    expect(next[0].type).toBe("string");
    expect(next[0].value).toBeNull();
  });

  it.each([
    { type: "string" as const, value: "text" },
    { type: "boolean" as const, value: false },
    { type: "enum" as const, value: "focused", choices: ["focused", "broad"] },
  ])("clears a $type input default back to required", async (variable) => {
    const onChange = renderPanel([{ name: "required_value", source: "input", ...variable }]);
    const user = userEvent.setup();
    await user.click(screen.getByText("required_value"));

    const control = screen.getByLabelText("Default");
    if (variable.type === "string") {
      await user.clear(control);
    } else {
      await user.click(control);
      await user.click(screen.getByRole("option", { name: "No default" }));
    }

    const next = onChange.mock.calls.at(-1)?.[0] as PipelineVariable[];
    expect(next[0].value).toBeNull();
  });

  it("adds a variable with a non-colliding name", async () => {
    const onChange = renderPanel([{ name: "variable", type: "integer", value: 1 }]);
    await userEvent.click(screen.getByRole("button", { name: "Add variable" }));
    const next = onChange.mock.calls[0][0] as PipelineVariable[];
    expect(next).toHaveLength(2);
    expect(next[1].name).toBe("variable_2");
  });

  it("previews a derived variable's value from input defaults", () => {
    renderPanel([TOP_K, { name: "candidates", type: "integer", expression: "top_k * 2" }]);
    expect(screen.getByText("= 10")).toBeInTheDocument();
  });

  it("shows the reference sites before deleting a used variable", async () => {
    renderPanel(
      [
        { name: "factor", type: "integer", value: 3 },
        { name: "candidates", type: "integer", expression: "factor * 2" },
      ],
      vi.fn(),
      [INPUT_NODE, { type: "retriever.vector", config: { top_k: { $expr: "factor + 1" } } }],
    );
    await userEvent.click(screen.getByText("factor"));
    expect(
      screen.getByText(/Used by variable candidates, retriever.vector · top_k/),
    ).toBeInTheDocument();
  });

  it("flags a reserved name on the row", async () => {
    renderPanel([{ name: "query", type: "string", value: "x" }]);
    expect(screen.getByText("'query' is reserved.")).toBeInTheDocument();
  });

  it("deduplicates enum choices while preserving their first-seen order", async () => {
    const onChange = renderPanel([
      {
        name: "mode",
        type: "enum",
        source: "input",
        value: "focused",
        choices: ["focused", "broad"],
      },
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByText("mode"));
    const choices = screen.getByLabelText("Choices");
    fireEvent.change(choices, {
      target: { value: "focused, focused, broad, focused" },
    });

    const next = onChange.mock.calls.at(-1)?.[0] as PipelineVariable[];
    expect(next[0].choices).toEqual(["focused", "broad"]);
  });
});
