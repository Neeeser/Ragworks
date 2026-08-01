import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LlmNodeFields } from "../LlmNodeFields";

const TRANSFORM_TYPE = "llm.transform";

const renderFields = (
  nodeType: string,
  config: Record<string, unknown>,
  onConfigChange = vi.fn(),
) => {
  render(
    <LlmNodeFields
      nodeType={nodeType}
      config={config}
      disabled={false}
      validationIssues={[]}
      onConfigChange={onConfigChange}
    />,
  );
  return onConfigChange;
};

describe("LlmNodeFields", () => {
  it("writes prompt edits into config", async () => {
    const user = userEvent.setup();
    const onChange = renderFields(TRANSFORM_TYPE, { prompt: "" });
    await user.type(screen.getByLabelText("Prompt"), "x");
    expect(onChange).toHaveBeenLastCalledWith({ prompt: "x" });
  });

  it("adds a shell-appropriate output field", async () => {
    const user = userEvent.setup();
    const onChange = renderFields("llm.rerank", {});
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(onChange).toHaveBeenCalledWith({
      output_fields: [
        { name: "score", type: "number", description: "", target: { kind: "score" } },
      ],
    });
  });

  it("changing the target to metadata offers a key input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFields(
      TRANSFORM_TYPE,
      {
        output_fields: [
          {
            name: "context",
            type: "string",
            description: "",
            target: { kind: "text", mode: "prepend", separator: "\n\n" },
          },
        ],
      },
      onChange,
    );
    await user.click(screen.getByLabelText("Field 1 write target"));
    await user.click(screen.getByRole("option", { name: "Metadata key" }));
    const last = onChange.mock.calls.at(-1)?.[0] as {
      output_fields: Array<{ target: { kind: string } }>;
    };
    expect(last.output_fields[0].target).toEqual({ kind: "metadata", key: "" });
  });

  it("removes a field", async () => {
    const user = userEvent.setup();
    const onChange = renderFields(TRANSFORM_TYPE, {
      output_fields: [
        {
          name: "topic",
          type: "string",
          description: "",
          target: { kind: "metadata", key: "topic" },
        },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Remove field 1" }));
    expect(onChange).toHaveBeenCalledWith({ output_fields: [] });
  });
});
