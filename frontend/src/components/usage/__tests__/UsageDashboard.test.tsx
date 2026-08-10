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

    expect(await screen.findAllByText("No usage recorded in this range.")).toHaveLength(2);
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
