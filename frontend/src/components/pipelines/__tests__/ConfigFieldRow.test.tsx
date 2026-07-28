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

const CHUNK_OVERLAP = "chunk_overlap";
const NODE_CHUNK = "chunk";
const CHUNK_SIZE = "chunk_size";
const OVERLAP_RATIO_EXPR = "round(self.chunk_size * 0.2)";
const OVERLAP_LABEL = "Chunk overlap";

const CHUNK_SIZE_FIELD: PipelineConfigField = {
  key: CHUNK_SIZE,
  label: "Chunk size",
  input: "integer",
  nullable: false,
  required: false,
  staticOnly: false,
  exprType: "integer",
  defaultValue: 512,
};

const renderRow = (config: Record<string, unknown>, onValueChange = vi.fn()) => {
  render(
    <ConfigFieldRow
      field={TOP_N_FIELD}
      siblingFields={[TOP_N_FIELD, CHUNK_SIZE_FIELD]}
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

describe("the self scope in a config field", () => {
  it("resolves an expression over a sibling and shows the number it produces", async () => {
    render(
      <ConfigFieldRow
        field={{ ...TOP_N_FIELD, key: CHUNK_OVERLAP, label: OVERLAP_LABEL }}
        siblingFields={[CHUNK_SIZE_FIELD, { ...TOP_N_FIELD, key: CHUNK_OVERLAP }]}
        nodeId={NODE_CHUNK}
        config={{ [CHUNK_SIZE]: 512, [CHUNK_OVERLAP]: { $expr: OVERLAP_RATIO_EXPR } }}
        env={env}
        disabled={false}
        onValueChange={vi.fn()}
        onLiteralChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("= 102")).toBeInTheDocument();
  });

  it("reads a sibling's default when the config does not set it", async () => {
    render(
      <ConfigFieldRow
        field={{ ...TOP_N_FIELD, key: CHUNK_OVERLAP, label: OVERLAP_LABEL }}
        siblingFields={[CHUNK_SIZE_FIELD, { ...TOP_N_FIELD, key: CHUNK_OVERLAP }]}
        nodeId={NODE_CHUNK}
        config={{ [CHUNK_OVERLAP]: { $expr: "round(self.chunk_size * 0.25)" } }}
        env={env}
        disabled={false}
        onValueChange={vi.fn()}
        onLiteralChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("= 128")).toBeInTheDocument();
  });

  it("refuses a field that reads itself, the shortest possible cycle", async () => {
    render(
      <ConfigFieldRow
        field={{ ...TOP_N_FIELD, key: CHUNK_OVERLAP, label: OVERLAP_LABEL }}
        siblingFields={[CHUNK_SIZE_FIELD, { ...TOP_N_FIELD, key: CHUNK_OVERLAP }]}
        nodeId={NODE_CHUNK}
        config={{ [CHUNK_OVERLAP]: { $expr: "self.chunk_overlap + 1" } }}
        env={env}
        disabled={false}
        onValueChange={vi.fn()}
        onLiteralChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(/cannot read itself/)).toBeInTheDocument();
  });
});

describe("a field that declares a seed expression", () => {
  it("starts the fx toggle from the node's formula instead of an empty box", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const seeded: PipelineConfigField = {
      ...TOP_N_FIELD,
      key: CHUNK_OVERLAP,
      label: OVERLAP_LABEL,
      exprSeed: OVERLAP_RATIO_EXPR,
    };
    render(
      <ConfigFieldRow
        field={seeded}
        siblingFields={[CHUNK_SIZE_FIELD, seeded]}
        nodeId={NODE_CHUNK}
        config={{ [CHUNK_SIZE]: 512, [CHUNK_OVERLAP]: 102 }}
        env={env}
        disabled={false}
        onValueChange={onValueChange}
        onLiteralChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /toggle expression mode/i }));

    expect(onValueChange).toHaveBeenCalledWith(CHUNK_OVERLAP, {
      $expr: OVERLAP_RATIO_EXPR,
    });
  });
});

describe("clearing a number box", () => {
  it("stays empty while the user retypes instead of snapping back to the default", async () => {
    const user = userEvent.setup();
    render(
      <ConfigFieldRow
        field={CHUNK_SIZE_FIELD}
        siblingFields={[CHUNK_SIZE_FIELD]}
        nodeId={NODE_CHUNK}
        config={{ [CHUNK_SIZE]: 512 }}
        env={env}
        disabled={false}
        onValueChange={vi.fn()}
        onLiteralChange={vi.fn()}
      />,
    );

    const box = screen.getByLabelText("Chunk size");
    await user.clear(box);

    // Writing `undefined` deletes the key, so without a draft the control
    // re-renders showing the schema default and the box refuses to empty.
    expect(box).toHaveValue(null);
  });
});
