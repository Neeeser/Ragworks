import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CollectionSidebar } from "@/components/collections/detail/CollectionSidebar";
import { makeCollection, makePublicConfig } from "@/test/fixtures";
import { resetMockAppConfig, setMockAppConfig } from "@/test/mocks";
import { setMockPathname } from "@/test/test-utils";

vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());

describe("CollectionSidebar", () => {
  const collection = makeCollection();

  it("renders every section as a route link and chat as a launch action", () => {
    resetMockAppConfig();
    render(<CollectionSidebar collection={collection} />);

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      `/collections/${collection.id}`,
    );
    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      `/collections/${collection.id}/files`,
    );
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute(
      "href",
      `/collections/${collection.id}/search`,
    );
    expect(screen.getByRole("link", { name: "Diagnostics" })).toHaveAttribute(
      "href",
      `/collections/${collection.id}/diagnostics`,
    );
    expect(screen.getByRole("link", { name: "Visualize" })).toHaveAttribute(
      "href",
      `/collections/${collection.id}/visualize`,
    );
    expect(screen.getByRole("link", { name: "Chat studio" })).toHaveAttribute(
      "href",
      `/chat?collections=${collection.id}`,
    );
  });

  it("marks the current route active, including nested files paths", () => {
    resetMockAppConfig();
    setMockPathname(`/collections/${collection.id}/files/docs/reports`);
    render(<CollectionSidebar collection={collection} />);

    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("hides the Visualize nav item when the umap feature flag is disabled", () => {
    setMockAppConfig({
      config: makePublicConfig({ features: { umap_visualizations: false, chat_branching: true } }),
    });
    render(<CollectionSidebar collection={collection} />);

    expect(screen.queryByText("Visualize")).not.toBeInTheDocument();
  });
});
