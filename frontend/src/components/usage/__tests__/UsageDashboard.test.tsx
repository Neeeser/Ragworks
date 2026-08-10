import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

import { UsageDashboard } from "@/components/usage/UsageDashboard";
import * as api from "@/lib/api";
import {
  makeUsageEvent,
  makeUsageEventPage,
  makeUsageGroupRow,
  makeUsageSeriesPoint,
  makeUsageSummary,
  makeUsageUnitTotal,
} from "@/test/fixtures";

const BREAKDOWN = "Usage breakdown";
const MODEL = "openai/gpt-4o-mini";

function breakdown() {
  return screen.getByRole("region", { name: BREAKDOWN });
}

describe("UsageDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a sub-cent cost at the precision it needs", async () => {
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({ groups: [makeUsageGroupRow({ cost_usd: 0.0031 })] }),
    );

    render(<UsageDashboard scope="user" />);

    expect(await within(breakdown()).findByText("$0.0031")).toBeInTheDocument();
  });

  it("leaves an unpriced row's cost blank rather than claiming it was free", async () => {
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        groups: [makeUsageGroupRow({ key: "local/embedder", cost_usd: null })],
        totals: [makeUsageUnitTotal({ cost_usd: null })],
        total_cost_usd: null,
      }),
    );

    render(<UsageDashboard scope="user" />);

    const rows = within(await screen.findByRole("region", { name: BREAKDOWN }));
    expect(await rows.findByText("local/embedder")).toBeInTheDocument();
    expect(rows.queryByText("$0.00")).not.toBeInTheDocument();
    expect(rows.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps a group's two units as two rows, never one merged quantity", async () => {
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        groups: [
          makeUsageGroupRow({ key: "model-a", unit: "tokens", quantity: 1_000 }),
          makeUsageGroupRow({ key: "model-a", unit: "read_units", quantity: 40 }),
        ],
      }),
    );

    render(<UsageDashboard scope="user" />);

    const rows = within(await screen.findByRole("region", { name: BREAKDOWN }));
    expect(await rows.findByText("1,000")).toBeInTheDocument();
    expect(rows.getByText("40")).toBeInTheDocument();
    expect(rows.queryByText("1,040")).not.toBeInTheDocument();
  });

  it("states an empty range instead of drawing an empty chart", async () => {
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({ groups: [], series: [], totals: [], total_cost_usd: null }),
    );

    render(<UsageDashboard scope="user" />);

    // One copy, four panels: the chart, both breakdowns, and the table.
    expect(await screen.findAllByText("No usage recorded in this range.")).toHaveLength(4);
  });

  it("reports a failed breakdown fetch instead of calling the range empty", async () => {
    vi.mocked(api.fetchUsageSummary).mockImplementation(async (_token, _scope, params) => {
      if (params.group_by === "surface") throw new Error("surface rollup unavailable");
      return makeUsageSummary();
    });

    render(<UsageDashboard scope="user" />);

    expect(await screen.findByText("surface rollup unavailable")).toBeInTheDocument();
  });

  it("reports a failed account list rather than showing an admin one account", async () => {
    vi.mocked(api.fetchAdminUsers).mockRejectedValue(new Error("users endpoint down"));

    render(<UsageDashboard scope="admin" />);

    expect(await screen.findByText(/users endpoint down/)).toBeInTheDocument();
  });

  it("draws a total line beside the per-kind lines under the cost measure", async () => {
    render(<UsageDashboard scope="user" />);

    // The legend is what carries series identity, so it is what proves the
    // total is drawn.
    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("says why cost buckets are missing when the range holds unpriced events", async () => {
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        series: [
          makeUsageSeriesPoint({ cost_usd: 0.01 }),
          makeUsageSeriesPoint({ kind: "rerank", unit: "search_units", cost_usd: null }),
        ],
      }),
    );

    render(<UsageDashboard scope="user" />);

    expect(
      await screen.findByText(/Buckets containing unpriced events are omitted/),
    ).toBeInTheDocument();
  });

  it("offers Cost on a mixed instance whose unit totals the API suppressed", async () => {
    // OpenRouter (priced) beside OpenAI/Cohere (unpriced): every unit total is
    // null, so reading pricedness off `totals` would leave a spend dashboard
    // with no way to see spend.
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        groups: [makeUsageGroupRow({ cost_usd: 0.00058 })],
        totals: [
          makeUsageUnitTotal({ unit: "search_units", quantity: 4, cost_usd: null }),
          makeUsageUnitTotal({ unit: "tokens", quantity: 900_000, cost_usd: null }),
        ],
        total_cost_usd: null,
      }),
    );

    render(<UsageDashboard scope="user" />);

    const measure = await screen.findByRole("group", { name: "Measure" });
    // Cost exists, and it is the pressed default — not the four-event unit the
    // API happened to list first.
    expect(within(measure).getByRole("button", { name: "Cost" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(measure).getByRole("button", { name: "Tokens" })).toBeInTheDocument();
  });

  it("discloses the categories a cost breakdown dropped for being unpriced", async () => {
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        groups: [
          makeUsageGroupRow({ key: "eval_run", unit: "tokens", cost_usd: 0.0004 }),
          makeUsageGroupRow({ key: "eval_run", unit: "search_units", cost_usd: null }),
          makeUsageGroupRow({ key: "chat", unit: "tokens", cost_usd: 0.002 }),
        ],
      }),
    );

    render(<UsageDashboard scope="user" />);

    expect(await screen.findAllByText(/1 with an unpriced unit omitted/)).not.toHaveLength(0);
  });

  it("redescribes the open group when the range it was picked in changes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        groups: [
          makeUsageGroupRow({ key: MODEL, unit: "tokens" }),
          makeUsageGroupRow({ key: MODEL, unit: "search_units" }),
        ],
      }),
    );

    render(<UsageDashboard scope="user" />);
    const rows = await within(breakdown()).findAllByRole("button", { name: new RegExp(MODEL) });
    await user.click(rows[0]);
    expect(
      within(await screen.findByRole("region", { name: /Events for/ })).getByText(
        "Tokens · Search units",
      ),
    ).toBeInTheDocument();

    // A narrower range where the group only ever spent tokens: the header has
    // to follow the data, not the snapshot taken at click time.
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({ groups: [makeUsageGroupRow({ key: MODEL, unit: "tokens" })] }),
    );
    await user.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => {
      expect(screen.queryByText("Tokens · Search units")).not.toBeInTheDocument();
    });
  });

  it("counts the categories a breakdown panel is not showing", async () => {
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        groups: Array.from({ length: 9 }, (_, index) =>
          makeUsageGroupRow({ key: `model-${index}`, quantity: index + 1 }),
        ),
      }),
    );

    render(<UsageDashboard scope="user" />);

    expect(await screen.findAllByText("+3 more not shown")).not.toHaveLength(0);
  });

  it("refetches the summary against the new grouping when the switch changes", async () => {
    const user = userEvent.setup();
    render(<UsageDashboard scope="user" />);
    await within(breakdown()).findByText(MODEL);

    await user.click(screen.getByRole("combobox", { name: "Group by" }));
    await user.click(await screen.findByRole("option", { name: "Surface" }));

    await waitFor(() => {
      // The breakdown panels fetch their own dimensions, so the assertion is
      // that this call happened — not that it was the last one issued.
      expect(api.fetchUsageSummary).toHaveBeenCalledWith(
        expect.any(String),
        "user",
        expect.objectContaining({ group_by: "surface" }),
      );
    });
  });

  it("drills a whole group in, naming every unit the list covers", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchUsageSummary).mockResolvedValue(
      makeUsageSummary({
        groups: [
          makeUsageGroupRow({ key: MODEL, unit: "tokens" }),
          makeUsageGroupRow({ key: MODEL, unit: "read_units" }),
        ],
      }),
    );

    render(<UsageDashboard scope="user" />);
    const rows = await within(breakdown()).findAllByRole("button", { name: new RegExp(MODEL) });
    // The events endpoint carries no unit filter, so both rows open the one
    // list — and the panel names the units that list spans.
    await user.click(rows[1]);

    const panel = await screen.findByRole("region", { name: /Events for/ });
    expect(within(panel).getByText("Tokens · Read units")).toBeInTheDocument();
    await waitFor(() => {
      expect(api.fetchUsageEvents).toHaveBeenCalledWith(
        expect.any(String),
        "user",
        expect.objectContaining({ model: MODEL }),
      );
    });
  });

  it("opens the events behind a row and pages through them", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchUsageEvents).mockResolvedValue(
      makeUsageEventPage({
        events: [makeUsageEvent({ id: "usage-1", model: MODEL })],
        total: 40,
      }),
    );

    render(<UsageDashboard scope="user" />);
    await user.click(await screen.findByRole("button", { name: /openai\/gpt-4o-mini/ }));

    const panel = await screen.findByRole("region", { name: /Events for/ });
    await waitFor(() => {
      expect(api.fetchUsageEvents).toHaveBeenLastCalledWith(
        expect.any(String),
        "user",
        expect.objectContaining({ model: MODEL, offset: 0 }),
      );
    });

    await user.click(within(panel).getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(api.fetchUsageEvents).toHaveBeenLastCalledWith(
        expect.any(String),
        "user",
        expect.objectContaining({ offset: 25 }),
      );
    });
  });

  it("links an event to the page its context lives on", async () => {
    vi.mocked(api.fetchUsageEvents).mockResolvedValue(
      makeUsageEventPage({
        events: [makeUsageEvent({ context_type: "eval_run", context_id: "run-9" })],
      }),
    );
    const user = userEvent.setup();

    render(<UsageDashboard scope="user" />);
    await user.click(await screen.findByRole("button", { name: /openai\/gpt-4o-mini/ }));

    expect(await screen.findByRole("link", { name: "Eval run" })).toHaveAttribute(
      "href",
      "/evals/runs/run-9",
    );
  });

  it("names a context with no page in the app rather than linking nowhere", async () => {
    vi.mocked(api.fetchUsageEvents).mockResolvedValue(
      makeUsageEventPage({
        events: [makeUsageEvent({ context_type: "connection_probe", context_id: "probe-1" })],
      }),
    );
    const user = userEvent.setup();

    render(<UsageDashboard scope="user" />);
    await user.click(await screen.findByRole("button", { name: /openai\/gpt-4o-mini/ }));

    expect(await screen.findByText("connection probe")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "connection probe" })).not.toBeInTheDocument();
  });

  it("scopes the admin ledger to the account picked in the filter", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchAdminUsers).mockResolvedValue([
      { id: "user-9", email: "bob@example.com" } as never,
    ]);

    render(<UsageDashboard scope="admin" />);
    await within(breakdown()).findByText(MODEL);

    await user.click(screen.getByRole("combobox", { name: "User" }));
    await user.click(await screen.findByRole("option", { name: "bob@example.com" }));

    await waitFor(() => {
      expect(api.fetchUsageSummary).toHaveBeenCalledWith(
        expect.any(String),
        "admin",
        expect.objectContaining({ user_id: "user-9" }),
      );
    });
  });
});
