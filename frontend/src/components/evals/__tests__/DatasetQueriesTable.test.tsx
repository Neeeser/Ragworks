import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DatasetQueriesTable } from "@/components/evals/DatasetQueriesTable";
import * as apiModule from "@/lib/api";
import { makeEvalDatasetQuery } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const QUERIES = {
  total: 2,
  items: [
    makeEvalDatasetQuery({
      id: "q-1",
      external_query_id: "synth-0001",
      text: "How many retries does the alpha subsystem attempt?",
      gold: [{ external_doc_id: "doc-1", title: "alpha.md" }],
    }),
    makeEvalDatasetQuery({
      id: "q-2",
      external_query_id: "synth-0002",
      text: "Which service owns failover?",
      question_type: "paraphrased",
      scores: null,
      quote: null,
      gold: [{ external_doc_id: "doc-2", title: null }],
    }),
  ],
};

describe("DatasetQueriesTable", () => {
  it("renders query text, gold titles, and generation metadata", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue(QUERIES);
    render(<DatasetQueriesTable datasetId="ds-1" />);
    expect(
      await screen.findByText("How many retries does the alpha subsystem attempt?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/gold: alpha\.md/)).toBeInTheDocument();
    // An untitled gold falls back to the external id.
    expect(screen.getByText(/gold: doc-2/)).toBeInTheDocument();
    expect(screen.getByText(/scores 5\/4\/4/)).toBeInTheDocument();
  });

  it("names the axes the compact score triple reports", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue(QUERIES);
    render(<DatasetQueriesTable datasetId="ds-1" />);
    await screen.findByText(/scores 5\/4\/4/);
    const label = screen.getByText("Grader scores, 1–5: groundedness · standalone · realism");
    expect(label).toHaveAttribute("role", "tooltip");
  });

  it("saves an edited query through the API and reloads", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue(QUERIES);
    const user = userEvent.setup();
    render(<DatasetQueriesTable datasetId="ds-1" />);
    await user.click(await screen.findByRole("button", { name: "Edit query synth-0001" }));
    const input = screen.getByRole("textbox", { name: "Query text" });
    await user.clear(input);
    await user.type(input, "How many retry attempts before failover?");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() =>
      expect(api.updateEvalDatasetQuery).toHaveBeenCalledWith(
        "test-token",
        "ds-1",
        "q-1",
        "How many retry attempts before failover?",
      ),
    );
    // Editing done: the reload re-fetches the page.
    expect(api.fetchEvalDatasetQueries.mock.calls.length).toBeGreaterThan(1);
  });

  it("deletes a query after confirmation", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue(QUERIES);
    const user = userEvent.setup();
    render(<DatasetQueriesTable datasetId="ds-1" />);
    await user.click(await screen.findByRole("button", { name: "Delete query synth-0002" }));
    await user.click(screen.getByRole("button", { name: "Delete query" }));
    await waitFor(() =>
      expect(api.deleteEvalDatasetQuery).toHaveBeenCalledWith("test-token", "ds-1", "q-2"),
    );
  });

  it("surfaces a failed delete through the error channel", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue({ total: 1, items: [QUERIES.items[0]] });
    api.deleteEvalDatasetQuery.mockRejectedValue(new Error("A dataset needs at least one query."));
    const user = userEvent.setup();
    render(<DatasetQueriesTable datasetId="ds-1" />);
    await user.click(await screen.findByRole("button", { name: "Delete query synth-0001" }));
    await user.click(screen.getByRole("button", { name: "Delete query" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A dataset needs at least one query.",
    );
  });
});
