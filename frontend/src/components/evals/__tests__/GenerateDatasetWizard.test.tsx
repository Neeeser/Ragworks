import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GenerateDatasetWizard } from "@/components/evals/GenerateDatasetWizard";
import { makeCatalogModel, makeCollection } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const QUESTIONS_STEP = "3 Questions";
const MODEL_STEP = "2 Model";

const STRUCTURED_MODEL = makeCatalogModel({
  id: "writer-1",
  name: "Writer One",
  supported_parameters: ["temperature", "structured_outputs"],
});

function renderWizard() {
  return render(
    <GenerateDatasetWizard
      open
      collections={[makeCollection({ id: "col-1", name: "Alpha" })]}
      chatModels={[STRUCTURED_MODEL]}
      onGenerate={async () => true}
      onClose={() => undefined}
    />,
  );
}

async function chooseCollection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Collection" }));
  await user.click(await screen.findByRole("option", { name: "Alpha" }));
}

describe("GenerateDatasetWizard", () => {
  it("keeps the questions step unreachable from the step list until a model is chosen", async () => {
    const user = userEvent.setup();
    renderWizard();

    // Nothing chosen: only the step the user is on is reachable.
    expect(screen.getByRole("button", { name: MODEL_STEP })).toBeDisabled();
    expect(screen.getByRole("button", { name: QUESTIONS_STEP })).toBeDisabled();

    await chooseCollection(user);

    // The source is named, so the model step opens — the questions step must
    // not, or the wizard posts a models map built from an empty key.
    expect(screen.getByRole("button", { name: MODEL_STEP })).toBeEnabled();
    expect(screen.getByRole("button", { name: QUESTIONS_STEP })).toBeDisabled();
  });

  it("opens the questions step once a model is chosen", async () => {
    const user = userEvent.setup();
    renderWizard();

    await chooseCollection(user);
    await user.click(screen.getByRole("button", { name: MODEL_STEP }));
    await user.click(await screen.findByRole("button", { name: "Writer One" }));

    expect(screen.getByRole("button", { name: QUESTIONS_STEP })).toBeEnabled();
  });
});
