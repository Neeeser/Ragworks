import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VariablesPanel } from "../VariablesPanel";

import type { PipelineVariable } from "@/lib/types";

const INPUT_NODE = {
  type: "retrieval.input",
  config: {
    arguments: [{ name: "top_k", type: "integer", default: 5 }],
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
  it("lists declared arguments from the retrieval input node", () => {
    renderPanel([]);
    expect(screen.getByText("top_k")).toBeInTheDocument();
    expect(screen.getByText("Declared on the retrieval input node.")).toBeInTheDocument();
  });

  it("adds a variable with a non-colliding name", async () => {
    const onChange = renderPanel([{ name: "variable", type: "integer", value: 1 }]);
    await userEvent.click(screen.getByRole("button", { name: "Add variable" }));
    const next = onChange.mock.calls[0][0] as PipelineVariable[];
    expect(next).toHaveLength(2);
    expect(next[1].name).toBe("variable_2");
  });

  it("previews a derived variable's value from argument defaults", () => {
    renderPanel([{ name: "candidates", type: "integer", expression: "top_k * 2" }]);
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
});
