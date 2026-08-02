import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MetadataFilterField } from "../MetadataFilterField";

import type { PipelineVariable } from "@/lib/types";

const variables: PipelineVariable[] = [{ name: "author_arg", type: "string", source: "input" }];

const renderField = (
  config: Record<string, unknown>,
  onConfigChange = vi.fn(),
  overrides: Partial<Parameters<typeof MetadataFilterField>[0]> = {},
) => {
  render(
    <MetadataFilterField
      config={config}
      variables={variables}
      disabled={false}
      validationIssues={[]}
      onConfigChange={onConfigChange}
      {...overrides}
    />,
  );
  return onConfigChange;
};

describe("MetadataFilterField", () => {
  it("adds a first condition into config.filter", async () => {
    const user = userEvent.setup();
    const onChange = renderField({});
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    expect(onChange).toHaveBeenCalledWith({
      filter: { all: [{ field: "", op: "eq", value: "" }] },
    });
  });

  it("removing the last condition deletes the filter key entirely", async () => {
    const user = userEvent.setup();
    const onChange = renderField({
      filter: { all: [{ field: "author", op: "eq", value: "Smith" }] },
      top_k: 5,
    });
    await user.click(screen.getByRole("button", { name: "Remove condition 1" }));
    expect(onChange).toHaveBeenCalledWith({ top_k: 5 });
  });

  it("infers numbers and booleans from typed literals", async () => {
    const user = userEvent.setup();
    const onChange = renderField({
      filter: { all: [{ field: "year", op: "gte", value: null }] },
    });
    await user.type(screen.getByLabelText("Condition 1 value"), "7");
    const last = onChange.mock.calls.at(-1)?.[0] as {
      filter: { all: Array<{ value: unknown }> };
    };
    expect(last.filter.all[0].value).toBe(7);
  });

  it("binding a variable clears the literal value input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderField({ filter: { all: [{ field: "author", op: "eq", value: "x" }] } }, onChange);
    await user.click(screen.getByLabelText("Condition 1 value source"));
    await user.click(screen.getByRole("option", { name: "var: author_arg" }));
    expect(onChange).toHaveBeenCalledWith({
      filter: { all: [{ field: "author", op: "eq", value: null, var: "author_arg" }] },
    });
  });

  it("an exists condition offers no value input", () => {
    renderField({ filter: { all: [{ field: "tag", op: "exists" }] } });
    expect(screen.queryByLabelText("Condition 1 value")).not.toBeInTheDocument();
  });
});
