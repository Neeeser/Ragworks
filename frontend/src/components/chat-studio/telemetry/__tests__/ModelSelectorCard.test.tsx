import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModelSelectorCard } from "@/components/chat-studio/telemetry/ModelSelectorCard";
import * as apiModule from "@/lib/api";
import { makeCatalogModel, makeModelShortlist, makeShortlistEntry } from "@/test/fixtures";
import { resetMockAuth } from "@/test/mocks";

import type { CatalogModel } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const MODELS: CatalogModel[] = [
  makeCatalogModel({ id: "model-1", name: "Alpha", context_length: 4096 }),
  makeCatalogModel({ id: "model-2", name: "Beta", context_length: 1024 }),
];

function renderCard(props: Partial<Parameters<typeof ModelSelectorCard>[0]> = {}) {
  return render(
    <ModelSelectorCard
      currentModelInfo={MODELS[0] ?? null}
      selectedModelKey="model-1"
      selectedConnectionId={MODELS[0]?.connection_id}
      toolReadyModels={MODELS}
      filteredModelCatalog={MODELS}
      modelsLoading={false}
      modelsError={null}
      toolsEnabled
      onSelectModel={() => undefined}
      {...props}
    />,
  );
}

describe("ModelSelectorCard", () => {
  beforeEach(() => {
    resetMockAuth();
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
  });

  it("opens on the All tab when the user has no pins or recents", async () => {
    renderCard();

    // A new account has an empty shortlist, so landing on Pinned would show a
    // hint where the models should be.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("opens on the Pinned tab and lists the pinned model when pins exist", async () => {
    api.fetchModelShortlist.mockResolvedValue(
      makeModelShortlist({ pinned: [makeShortlistEntry({ model_id: "model-2" })] }),
    );

    renderCard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pinned" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument();
  });

  it("records the model as used when one is selected", async () => {
    const onSelectModel = vi.fn();
    renderCard({ onSelectModel });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Beta" }));

    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: "model-2" }));
    await waitFor(() =>
      expect(api.recordModelUse).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: "chat", model_id: "model-2" }),
      ),
    );
  });

  it("pins a model from its row and reloads the shortlist", async () => {
    renderCard();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Pin Beta" }));

    await waitFor(() =>
      expect(api.pinModel).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: "chat", model_id: "model-2" }),
      ),
    );
  });

  it("surfaces a catalog error", async () => {
    renderCard({ modelsError: "Catalog unavailable" });

    expect(await screen.findByText("Catalog unavailable")).toBeInTheDocument();
  });
});
