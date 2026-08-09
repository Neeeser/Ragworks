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

const NO_ROUTE = "[Errno 113] No route to host";

const OLLAMA_DOWN = makeConnectionCatalogError({
  connection_id: "ollama-1",
  connection_label: "Ollama",
  provider_type: "ollama",
  message: NO_ROUTE,
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

describe("the picker while its catalog is refreshing", () => {
  beforeEach(() => {
    resetMockAuth();
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
  });

  it("keeps the models on screen instead of reporting a wait", async () => {
    renderPicker({ loading: true });

    // A refresh behind a list the user is already reading is not a wait; the
    // spinner belongs to a picker that has nothing to show yet.
    expect(await screen.findByText(/Gemma 4 26B/)).toBeInTheDocument();
    expect(screen.queryByText("Syncing")).not.toBeInTheDocument();
  });

  it("reports the wait while it has nothing to show", async () => {
    renderPicker({ models: [], loading: true });

    expect(await screen.findByText("Syncing")).toBeInTheDocument();
  });
});

describe("a provider that failed to list its models", () => {
  beforeEach(() => {
    resetMockAuth();
    api.fetchModelShortlist.mockResolvedValue(makeModelShortlist());
  });

  it("sits in the catalog as one of the providers, reporting its state", async () => {
    renderPicker();

    // A drawer like every other provider, saying where the others say a count —
    // the reachable provider's models stay selectable beside it.
    const head = await screen.findByRole("button", { name: /Ollama/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Gemma 4 26B/ }).length).toBeGreaterThan(0);

    // The provider's own reason is what the user opens it for.
    expect(screen.queryByText(NO_ROUTE)).not.toBeInTheDocument();
    await userEvent.click(head);
    expect(screen.getByText(NO_ROUTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connection" })).toHaveAttribute(
      "href",
      "/settings",
    );
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
    // the user is not choosing from stays out of their shortlist entirely.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Gemma 4 26B/ }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Unreachable")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByRole("button", { name: /Ollama/ })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("Unreachable")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Ollama/ }));
    expect(screen.getByText(NO_ROUTE)).toBeInTheDocument();
  });
});
