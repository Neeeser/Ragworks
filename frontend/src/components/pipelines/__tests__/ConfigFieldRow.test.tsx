import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldRow } from "../ConfigFieldRow";
import { buildStaticEnvironment } from "../lib/variable-env";

import type { PipelineConfigField } from "../lib/pipeline-config";
import type { PipelineVariable } from "@/lib/types";

const VARIABLES: PipelineVariable[] = [
  { name: "top_k", type: "integer", source: "input", value: 5 },
  { name: "label", type: "string", value: "docs" },
];

const env = buildStaticEnvironment(VARIABLES);

const TOP_N_FIELD: PipelineConfigField = {
  key: "max_results",
  label: "Top N",
  input: "integer",
  nullable: true,
  required: false,
  staticOnly: false,
  exprType: "integer",
};

const renderRow = (config: Record<string, unknown>, onValueChange = vi.fn()) => {
  render(
    <ConfigFieldRow
      field={TOP_N_FIELD}
      nodeId="limit"
      config={config}
      env={env}
      disabled={false}
      onValueChange={onValueChange}
      onLiteralChange={vi.fn()}
    />,
  );
  return onValueChange;
};

describe("ConfigFieldRow ƒx toggle", () => {
  it("switches between literal and expression mode with a pressed state", async () => {
    const user = userEvent.setup();
    const onValueChange = renderRow({ max_results: 3 });
    const toggle = screen.getByRole("button", { name: "Toggle expression mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(onValueChange).toHaveBeenCalledWith("max_results", { $expr: "" });
  });

  it("clears the expression back to a literal when pressed again", async () => {
    const user = userEvent.setup();
    const onValueChange = renderRow({ max_results: { $expr: "top_k" } });
    const toggle = screen.getByRole("button", { name: "Toggle expression mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(onValueChange).toHaveBeenCalledWith("max_results", undefined);
  });
});

describe("ConfigFieldRow literal-mode variable awareness", () => {
  it("offers type-matched variables when a number literal is focused", async () => {
    const user = userEvent.setup();
    renderRow({ max_results: 3 });
    await user.click(screen.getByLabelText("Top N"));
    const listbox = screen.getByRole("listbox", { name: "Expression suggestions" });
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /top_k/ })).toBeInTheDocument();
    // Functions are omitted in literal mode — picking one without an argument
    // would produce a broken expression.
    expect(screen.queryByRole("option", { name: /clamp/ })).not.toBeInTheDocument();
  });

  it("converts the field to expression mode when a variable is picked", async () => {
    const user = userEvent.setup();
    const onValueChange = renderRow({ max_results: 3 });
    await user.click(screen.getByLabelText("Top N"));
    await user.click(screen.getByRole("option", { name: /top_k/ }));
    expect(onValueChange).toHaveBeenCalledWith("max_results", { $expr: "top_k" });
  });

  it("converts to expression mode seeded with a typed letter", async () => {
    const user = userEvent.setup();
    const onValueChange = renderRow({ max_results: 3 });
    await user.click(screen.getByLabelText("Top N"));
    await user.keyboard("t");
    expect(onValueChange).toHaveBeenCalledWith("max_results", { $expr: "t" });
  });
});
