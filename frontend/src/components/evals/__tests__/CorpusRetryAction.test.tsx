import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CorpusRetryAction } from "@/components/evals/CorpusRetryAction";
import * as apiModule from "@/lib/api";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

describe("CorpusRetryAction", () => {
  it("requeues the collection's documents and says a new run scores them", async () => {
    api.retryEvalCorpusDocuments.mockResolvedValueOnce({ queued: 2 });
    const onQueued = vi.fn();
    render(<CorpusRetryAction collectionId="coll-1" onQueued={onQueued} />);

    await userEvent.click(screen.getByRole("button", { name: "Retry failed documents" }));

    expect(api.retryEvalCorpusDocuments).toHaveBeenCalledWith(expect.any(String), "coll-1");
    // Repairing the corpus and re-scoring are two steps; saying only "2 queued"
    // leaves the user waiting for metrics that never move on their own.
    expect(
      screen.getByText(/2 documents queued for ingestion\. Start a new run/),
    ).toBeInTheDocument();
    expect(onQueued).toHaveBeenCalled();
  });

  it("reports a rejected retry instead of looking like it worked", async () => {
    api.retryEvalCorpusDocuments.mockRejectedValueOnce(new Error("Eval collection not found."));
    render(<CorpusRetryAction collectionId="coll-1" />);

    await userEvent.click(screen.getByRole("button", { name: "Retry failed documents" }));

    expect(screen.getByText("Eval collection not found.")).toBeInTheDocument();
    expect(screen.queryByText(/queued for ingestion/)).not.toBeInTheDocument();
  });
});
