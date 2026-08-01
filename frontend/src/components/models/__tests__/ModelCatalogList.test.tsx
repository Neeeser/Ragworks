import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelCatalogList } from "@/components/models/ModelCatalogList";
import { makeCatalogModel } from "@/test/fixtures";

import type { CatalogModel } from "@/lib/types";

const BIG_PROVIDER = "conn-openrouter-1";
const SMALL_PROVIDER = "conn-ollama-1";

/** A provider big enough that its drawer must start collapsed. */
function bigCatalog(count: number): CatalogModel[] {
  return Array.from({ length: count }, (_, index) =>
    makeCatalogModel({
      connection_id: BIG_PROVIDER,
      connection_label: "OpenRouter",
      id: `openrouter/model-${index}`,
      name: `Model ${index}`,
    }),
  );
}

const SMALL_MODELS: CatalogModel[] = [
  makeCatalogModel({
    connection_id: SMALL_PROVIDER,
    connection_label: "Homelab Ollama",
    provider_type: "ollama",
    id: "qwen3:32b",
    name: "qwen3:32b",
  }),
];

function renderList(models: CatalogModel[], overrides: Record<string, unknown> = {}) {
  return render(
    <ModelCatalogList
      models={models}
      allModels={models}
      selectedKey={null}
      onSelect={vi.fn()}
      searching={false}
      emptyLabel="No models available."
      {...overrides}
    />,
  );
}

describe("ModelCatalogList", () => {
  it("collapses a large provider and keeps a small one open", () => {
    renderList([...bigCatalog(20), ...SMALL_MODELS]);

    // The big provider's rows would otherwise bury every other connection.
    expect(screen.queryByRole("button", { name: "Model 0" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "qwen3:32b" })).toBeInTheDocument();
  });

  it("shows how many models each provider holds", () => {
    renderList([...bigCatalog(20), ...SMALL_MODELS]);

    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens a collapsed provider on click", async () => {
    renderList([...bigCatalog(20), ...SMALL_MODELS]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /OpenRouter/ }));

    expect(screen.getByRole("button", { name: "Model 0" })).toBeInTheDocument();
  });

  it("expands every drawer while searching, and counts what the search excluded", () => {
    const all = [...bigCatalog(20), ...SMALL_MODELS];
    renderList([all[0] as CatalogModel], { allModels: all, searching: true });

    // A match hidden behind a collapsed head reads as "no results".
    expect(screen.getByRole("button", { name: "Model 0" })).toBeInTheDocument();
    expect(screen.getByText("1 of 20")).toBeInTheDocument();
  });

  it("names providers with no match instead of dropping them", () => {
    const all = [...bigCatalog(20), ...SMALL_MODELS];
    renderList([all[0] as CatalogModel], { allModels: all, searching: true });

    // A provider silently missing from the list looks like a broken connection.
    expect(screen.getByText(/No matches in Homelab Ollama/)).toBeInTheDocument();
  });
});
