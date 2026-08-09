import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModelPickerInline } from "@/components/models/ModelPickerInline";
import * as apiModule from "@/lib/api";
import {
  makeCatalogModel,
  makeConnectionCatalogError,
  makeModelShortlist,
  makeShortlistEntry,
} from "@/test/fixtures";
import { resetMockAuth } from "@/test/mocks";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const WORKING = makeCatalogModel({
  connection_id: "openrouter-1",
  connection_label: "OpenRouter",
  provider_type: "openrouter",
  id: "google/gemma-4-26b",
  name: "Gemma 4 26B",
});

const OLLAMA_DOWN = makeConnectionCatalogError({
  connection_id: "ollama-1",
  connection_label: "Ollama",
  provider_type: "ollama",
  message: "[Errno 113] No route to host",
});

function renderPicker(overrides: Record<string, unknown> = {}) {
  return render(
    <ModelPickerInline
      kind="chat"
      models={[WORKING]}
      onSelectModel={vi.fn()}
      loading={false}
      modelsError={null}
      connectionErrors={[OLLAMA_DOWN]}
      copy={{
        placeholder: "Select a chat model",
        searchPlaceholder: "Search chat models…",
        emptyLabel: "No chat models available.",
      }}
      {...overrides}
    />,
  );
}

describe("a provider that failed to list its models", () => {
  beforeEach(() => {
    resetMockAuth();
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
  });

  it("is stated inside the catalog beside the providers that answered", async () => {
    renderPicker();

    // The failure names the connection that failed, carries the provider's own
    // reason, and routes to where it can be fixed — while the reachable
    // provider's models stay selectable next to it.
    expect(await screen.findByText("Ollama")).toBeInTheDocument();
    expect(screen.getByText("[Errno 113] No route to host")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connection" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getAllByRole("button", { name: /Gemma 4 26B/ }).length).toBeGreaterThan(0);
  });

  it("stays out of the shortlist the user works from when it explains nothing there", async () => {
    api.fetchModelShortlist.mockResolvedValue(
      makeModelShortlist({
        pinned: [
          makeShortlistEntry({ connection_id: WORKING.connection_id, model_id: WORKING.id }),
        ],
        recent: [],
      }),
    );

    renderPicker();

    // The picker opens on Pinned, and every pin there resolved — so a provider
    // the user is not choosing from is not worth a red block over their models.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Gemma 4 26B/ }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("[Errno 113] No route to host")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByText("[Errno 113] No route to host")).toBeInTheDocument();
  });

  it("explains a pinned model that vanished with its provider", async () => {
    api.fetchModelShortlist.mockResolvedValue(
      makeModelShortlist({
        pinned: [makeShortlistEntry({ connection_id: "ollama-1", model_id: "qwen3:32b" })],
        recent: [],
      }),
    );

    renderPicker();

    // The pin cannot be resolved against a catalog its provider never answered,
    // so without the failure the user's own pin is simply missing.
    await waitFor(() =>
      expect(screen.getByText("[Errno 113] No route to host")).toBeInTheDocument(),
    );
  });
});
