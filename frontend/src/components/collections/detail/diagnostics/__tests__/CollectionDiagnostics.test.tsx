import { render, screen, waitFor } from "@testing-library/react";
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

  it("shows the empty state when there are no findings", async () => {
    api.fetchCollectionDiagnostics.mockResolvedValueOnce(
      makeCollectionDiagnostics({ diagnostics: [] }),
    );
    render(<CollectionDiagnostics collectionId="col-1" token="t" />);
    await waitFor(() =>
      expect(screen.getByText(/pipelines and indexed data look consistent/)).toBeInTheDocument(),
    );
  });
});
