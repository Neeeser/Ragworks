import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CollectionDiagnostics } from "@/components/collections/detail/diagnostics/CollectionDiagnostics";
import * as apiModule from "@/lib/api";
import { makeCollectionDiagnostics, makeDiagnostic } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
const api = vi.mocked(apiModule);

describe("CollectionDiagnostics", () => {
  it("groups findings by category with section headers", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValueOnce(
      makeCollectionDiagnostics({
        diagnostics: [
          makeDiagnostic(),
          makeDiagnostic({
            code: "recent_retrieval_failures",
            category: "run_failures",
            severity: "warning",
            title: "1 recent search failure",
          }),
        ],
      }),
    );
    render(<CollectionDiagnostics collectionId="col-1" token="t" />);

    await waitFor(() => expect(screen.getByText("Embedding models differ")).toBeInTheDocument());
    expect(screen.getByText("Embedding compatibility")).toBeInTheDocument();
    expect(screen.getByText("Recent run failures")).toBeInTheDocument();
    expect(screen.getByText("1 recent search failure")).toBeInTheDocument();
  });

  it("summarizes the run: verdict, counts, and when it was checked", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValueOnce(
      makeCollectionDiagnostics({
        diagnostics: [makeDiagnostic({ severity: "warning" })],
      }),
    );
    render(<CollectionDiagnostics collectionId="col-1" token="t" />);

    // `consistent` claims the configuration is sound, not that the list is empty.
    await waitFor(() => expect(screen.getByText("Configuration consistent")).toBeInTheDocument());
    expect(screen.getByText("Errors").parentElement).toHaveTextContent("Errors0");
    expect(screen.getByText("Warnings").parentElement).toHaveTextContent("Warnings1");
    expect(screen.getByText("Checked")).toBeInTheDocument();
  });

  it("reports issues when a finding is an error", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValueOnce(makeCollectionDiagnostics());
    render(<CollectionDiagnostics collectionId="col-1" token="t" />);
    await waitFor(() => expect(screen.getByText("Issues found")).toBeInTheDocument());
  });

  it("re-runs the checks when Re-run is pressed", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValue(makeCollectionDiagnostics());
    render(<CollectionDiagnostics collectionId="col-1" token="t" />);
    await waitFor(() => expect(api.fetchCollectionDiagnostics).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "Re-run" }));
    await waitFor(() => expect(api.fetchCollectionDiagnostics).toHaveBeenCalledTimes(2));
  });

  it("shows the failure in place when diagnostics cannot be loaded", async () => {
    api.fetchCollectionDiagnostics.mockRejectedValueOnce(new Error("Diagnostics unavailable"));
    render(<CollectionDiagnostics collectionId="col-1" token="t" />);
    await waitFor(() => expect(screen.getByText("Diagnostics unavailable")).toBeInTheDocument());
  });

  it("shows the empty state when there are no findings", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValueOnce(
      makeCollectionDiagnostics({ diagnostics: [] }),
    );
    render(<CollectionDiagnostics collectionId="col-1" token="t" />);
    await waitFor(() =>
      expect(screen.getByText(/pipelines and indexed data are consistent/)).toBeInTheDocument(),
    );
  });
});
