import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsCard } from "@/components/collections/detail/overview/DiagnosticsCard";
import * as apiModule from "@/lib/api";
import { makeCollectionDiagnostics, makeDiagnostic } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
const api = vi.mocked(apiModule);

describe("DiagnosticsCard", () => {
  it("shows the error/warning counts and an issues pill when inconsistent", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValueOnce(
      makeCollectionDiagnostics({ diagnostics: [makeDiagnostic()] }),
    );
    render(<DiagnosticsCard collectionId="col-1" token="t" />);

    await waitFor(() => expect(screen.getByText("Issues found")).toBeInTheDocument());
    expect(screen.getByText(/1 error/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View diagnostics" })).toHaveAttribute(
      "href",
      "/collections/col-1/diagnostics",
    );
  });

  it("labels a clean collection 'Configuration consistent'", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValueOnce(
      makeCollectionDiagnostics({ diagnostics: [] }),
    );
    render(<DiagnosticsCard collectionId="col-1" token="t" />);
    await waitFor(() => expect(screen.getByText("Configuration consistent")).toBeInTheDocument());
  });
});
