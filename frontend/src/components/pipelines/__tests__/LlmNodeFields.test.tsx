import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { makePromptRead } from "@/test/fixtures";

import { LlmNodeFields } from "../LlmNodeFields";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const TRANSFORM_TYPE = "llm.transform";

type Config = Record<string, unknown>;

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
  it("writes a picked library prompt as a latest-version reference", async () => {
    const user = userEvent.setup();
    const onChange = renderFields(TRANSFORM_TYPE, { prompt: "old inline text" });
    await user.click(await screen.findByRole("combobox", { name: "Prompt" }));
    await user.click(await screen.findByRole("option", { name: "Base prompt" }));
    expect(onChange).toHaveBeenLastCalledWith({
      prompt: "",
      system_prompt: "",
      prompt_ref: { prompt_id: "prompt-1", version: "latest" },
    });
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

/** The drawer as it really behaves: config changes come back as props. */
function StatefulFields({ onConfigChange }: { onConfigChange: (c: Config) => void }) {
  const [config, setConfig] = useState<Config>({
    prompt_ref: { prompt_id: "prompt-1", version: "latest" },
  });
  return (
    <LlmNodeFields
      nodeType={TRANSFORM_TYPE}
      config={config}
      disabled={false}
      validationIssues={[]}
      onConfigChange={(next) => {
        setConfig(next);
        onConfigChange(next);
      }}
    />
  );
}

describe("editing a node's prompt in the studio overlay", () => {
  it("repoints the node at the fork instead of leaving it on the original", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulFields onConfigChange={onChange} />);

    // Opening the studio must not navigate — the node's unsaved graph and
    // the drawer both stay mounted underneath.
    await user.click(await screen.findByRole("button", { name: /Edit in prompt studio/ }));
    const studio = await screen.findByRole("dialog", { name: "Prompt studio" });
    expect(studio).toBeInTheDocument();

    // From here the list has a second entry: the fork the user is about
    // to make. A picker that does not refetch cannot name it.
    vi.mocked(api.listPrompts).mockResolvedValue([
      makePromptRead({ id: "prompt-1", name: "Original" }),
      makePromptRead({ id: "prompt-fork", name: "Forked" }),
    ]);
    await user.click(within(studio).getByRole("button", { name: "Fork" }));
    const forkDialog = await screen.findByRole("dialog", { name: "Fork prompt" });
    await user.click(within(forkDialog).getByRole("button", { name: "Fork" }));

    // Without this the user's edit is a silent no-op: the fork exists but
    // the node still runs the prompt they forked away from.
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prompt_ref: { prompt_id: "prompt-fork", version: "latest" },
        }),
      ),
    );
    // The picker must name the fork. Without a refetch it holds an id its
    // options do not contain and renders blank over a valid reference.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Prompt" })).toHaveTextContent("Forked"),
    );
  });
});
