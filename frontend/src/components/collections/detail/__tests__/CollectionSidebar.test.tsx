import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionSidebar } from "@/components/collections/detail/CollectionSidebar";
import { makeCollection, makePublicConfig } from "@/test/fixtures";
import { resetMockAppConfig, setMockAppConfig } from "@/test/mocks";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

describe("CollectionSidebar", () => {
  const collection = makeCollection();

  it("shows the Visualize nav item when the umap feature flag is enabled", () => {
    resetMockAppConfig();
    render(
      <CollectionSidebar collection={collection} activeView="overview" onSelectView={vi.fn()} />,
    );

    expect(screen.getByText("Visualize")).toBeInTheDocument();
  });

  it("hides the Visualize nav item when the umap feature flag is disabled", () => {
    setMockAppConfig({
      config: makePublicConfig({ features: { umap_visualizations: false, chat_branching: true } }),
    });
    render(
      <CollectionSidebar collection={collection} activeView="overview" onSelectView={vi.fn()} />,
    );

    expect(screen.queryByText("Visualize")).not.toBeInTheDocument();
  });
});
