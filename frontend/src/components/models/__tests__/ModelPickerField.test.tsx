import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModelPickerField } from "@/components/models/ModelPickerField";
import * as apiModule from "@/lib/api";
import { makeCatalogModel, makeModelShortlist } from "@/test/fixtures";
import { resetMockAuth } from "@/test/mocks";

import type { CatalogModel } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const MODELS: CatalogModel[] = [
  makeCatalogModel({ id: "model-1", name: "Alpha", input_modalities: ["text", "image"] }),
  makeCatalogModel({ id: "model-2", name: "Beta" }),
];

function renderField(props: Partial<Parameters<typeof ModelPickerField>[0]> = {}) {
  return render(
    <ModelPickerField
      kind="chat"
      aria-label="Model"
      models={MODELS}
      onSelectModel={vi.fn()}
      {...props}
    />,
  );
}

describe("ModelPickerField", () => {
  beforeEach(() => {
    resetMockAuth();
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
  });

  it("shows the selected model's identity and capabilities in the trigger", () => {
    renderField({ selectedConnectionId: MODELS[0]?.connection_id, selectedModelId: "model-1" });

    const trigger = screen.getByRole("button", { name: "Model" });
    expect(trigger).toHaveTextContent("Alpha");
    expect(trigger).toHaveTextContent("model-1");
    // The capability the provider stated, same mark the other pickers render.
    expect(within(trigger).getAllByText("Image input (vision)")).not.toHaveLength(0);
  });

  it("falls back to the stored id when the catalog cannot resolve it", () => {
    renderField({ selectedConnectionId: "conn-gone", selectedModelId: "ghost/model" });

    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("ghost/model");
  });

  it("opens the shared browser and reports the chosen model", async () => {
    const onSelectModel = vi.fn();
    renderField({ onSelectModel });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Model" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Beta" }));
    await user.click(within(dialog).getByRole("button", { name: /Use this model/ }));

    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: "model-2" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not open while disabled", async () => {
    renderField({ disabled: true });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Model" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
