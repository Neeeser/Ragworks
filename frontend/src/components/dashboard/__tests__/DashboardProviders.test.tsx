import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardProviders } from "@/components/dashboard/DashboardProviders";
import { makeConnectionCatalogError } from "@/test/fixtures";

describe("DashboardProviders", () => {
  it("names each unreachable connection, its reason, and where to fix it", () => {
    render(
      <DashboardProviders
        unreachable={[
          makeConnectionCatalogError({
            connection_id: "ollama-1",
            connection_label: "Ollama",
            message: "[Errno 113] No route to host",
          }),
        ]}
      />,
    );

    // Every pipeline bound to a dead provider fails on its next run, and this
    // is the only page that says so without opening a model picker.
    expect(screen.getByText("Ollama")).toBeInTheDocument();
    expect(screen.getByText("[Errno 113] No route to host")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings");
  });

  it("renders nothing when every connection answered", () => {
    const { container } = render(<DashboardProviders unreachable={[]} />);

    // A permanent "all providers reachable" line trains the user to skip the
    // row that matters.
    expect(container).toBeEmptyDOMElement();
  });
});
