import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DatasetQueriesTable } from "@/components/evals/DatasetQueriesTable";
import * as apiModule from "@/lib/api";
import { makeEvalDatasetQuery } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);

const DATASET_ID = "ds-1";
const TOKEN = "test-token";
const FIRST_QUERY_TEXT = "How many retries does the alpha subsystem attempt?";

const QUERIES = {
  total: 2,
  items: [
    makeEvalDatasetQuery({
      id: "q-1",
      external_query_id: "synth-0001",
      text: FIRST_QUERY_TEXT,
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
    render(<DatasetQueriesTable datasetId={DATASET_ID} />);
    expect(await screen.findByText(FIRST_QUERY_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/gold: alpha\.md/)).toBeInTheDocument();
    // An untitled gold falls back to the external id.
    expect(screen.getByText(/gold: doc-2/)).toBeInTheDocument();
    expect(screen.getByText(/scores 5\/4\/4/)).toBeInTheDocument();
  });

  it("names the axes the compact score triple reports, after a spaced separator", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue(QUERIES);
    render(<DatasetQueriesTable datasetId={DATASET_ID} />);
    const row = (await screen.findByText(FIRST_QUERY_TEXT)).closest("li");
    expect(row?.textContent).toContain(" · scores 5/4/4");
    // The separator belongs to the paragraph, not to the tooltip trigger: the
    // trigger is a flex box and its leading whitespace would be stripped.
    const trigger = screen.getByText(/scores 5\/4\/4/).closest("[class*='inline']");
    expect(trigger?.textContent).toBe("scores 5/4/4");
    const label = screen.getByText("Grader scores, 1–5: groundedness · standalone · realism");
    expect(label).toHaveAttribute("role", "tooltip");
  });

  it("saves an edited query through the API and reloads", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue(QUERIES);
    const user = userEvent.setup();
    render(<DatasetQueriesTable datasetId={DATASET_ID} />);
    await user.click(await screen.findByRole("button", { name: "Edit query synth-0001" }));
    const input = screen.getByRole("textbox", { name: "Query text" });
    await user.clear(input);
    await user.type(input, "How many retry attempts before failover?");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() =>
      expect(api.updateEvalDatasetQuery).toHaveBeenCalledWith(
        TOKEN,
        DATASET_ID,
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
    render(<DatasetQueriesTable datasetId={DATASET_ID} />);
    await user.click(await screen.findByRole("button", { name: "Delete query synth-0002" }));
    await user.click(screen.getByRole("button", { name: "Delete query" }));
    await waitFor(() =>
      expect(api.deleteEvalDatasetQuery).toHaveBeenCalledWith(TOKEN, DATASET_ID, "q-2"),
    );
  });

  it("surfaces a failed delete through the error channel", async () => {
    api.fetchEvalDatasetQueries.mockResolvedValue({ total: 1, items: [QUERIES.items[0]] });
    api.deleteEvalDatasetQuery.mockRejectedValue(new Error("A dataset needs at least one query."));
    const user = userEvent.setup();
    render(<DatasetQueriesTable datasetId={DATASET_ID} />);
    await user.click(await screen.findByRole("button", { name: "Delete query synth-0001" }));
    await user.click(screen.getByRole("button", { name: "Delete query" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A dataset needs at least one query.",
    );
  });
  it("renders an image query's picture from the dataset asset route", async () => {
    global.URL.createObjectURL = vi.fn(() => "blob:dataset");
    global.URL.revokeObjectURL = vi.fn();
    const media = {
      media_type: "image/png",
      path: "eval_datasets/ds-1/queries/q1.png",
      width: 640,
      height: 480,
    };
    api.fetchEvalDatasetQueries.mockResolvedValue({
      total: 1,
      items: [
        makeEvalDatasetQuery({ id: "q-img", external_query_id: "img-0001", text: null, media }),
      ],
    });

    const { container } = render(<DatasetQueriesTable datasetId={DATASET_ID} />);

    await waitFor(() =>
      expect(api.fetchEvalDatasetAssetBlob).toHaveBeenCalledWith(TOKEN, DATASET_ID, media.path),
    );
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Dataset record image" })).toBeInTheDocument(),
    );
    // The thumbnail's loading skeleton is a block element, invalid inside
    // <p> (React reports a hydration error) — media never nests in one.
    expect(container.querySelector("p img, p .skeleton")).toBeNull();
  });
});
