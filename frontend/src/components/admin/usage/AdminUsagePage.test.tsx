import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

import { AdminUsagePage } from "@/components/admin/usage/AdminUsagePage";
import * as api from "@/lib/api";

describe("AdminUsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders summary cards and per-user rows from the usage endpoints", async () => {
    render(<AdminUsagePage />);

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    // Headline cards reflect the summary fixture (3,400 tokens, 2 active users).
    expect(screen.getByText("3,400")).toBeInTheDocument();
    expect(screen.getByText("Active users")).toBeInTheDocument();
  });

  it("refetches both endpoints when the window changes", async () => {
    const user = userEvent.setup();
    render(<AdminUsagePage />);
    await screen.findByText("alice@example.com");

    await user.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => {
      expect(api.fetchAdminUsageSummary).toHaveBeenLastCalledWith(expect.any(String), 7);
      expect(api.fetchAdminUsageTimeseries).toHaveBeenLastCalledWith(expect.any(String), 7);
    });
  });

  it("surfaces a load failure in the alert region", async () => {
    vi.mocked(api.fetchAdminUsageSummary).mockRejectedValue(new Error("usage backend down"));

    render(<AdminUsagePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("usage backend down");
  });
});
