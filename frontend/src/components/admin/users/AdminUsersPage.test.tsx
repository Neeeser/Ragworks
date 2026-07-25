import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminUsersPage } from "@/components/admin/users/AdminUsersPage";
import * as apiModule from "@/lib/api";
import { makeAdminUser } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const api = vi.mocked(apiModule);
const ADMIN_EMAIL = "admin@example.com";
const MEMBER_EMAIL = "member@example.com";

describe("AdminUsersPage", () => {
  it("renders fetched users with role and access state", async () => {
    api.fetchAdminUsers.mockResolvedValueOnce([
      makeAdminUser({ id: "user-1", email: ADMIN_EMAIL, role: "admin" }),
      makeAdminUser({ id: "user-2", email: MEMBER_EMAIL, role: "user", is_active: false }),
    ]);

    render(<AdminUsersPage />);

    expect((await screen.findAllByText(ADMIN_EMAIL)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(MEMBER_EMAIL).length).toBeGreaterThan(0);
    // Scoped to the list: "Admin" also names the breadcrumb and a section tab.
    const list = screen.getByRole("region", { name: "Users" });
    expect(within(list).getByText("Admin")).toBeInTheDocument();
    expect(within(list).getByText("User")).toBeInTheDocument();
    // Access state is derived from is_active, not invented.
    expect(within(list).getByText("Active")).toBeInTheDocument();
    expect(within(list).getByText("Deactivated")).toBeInTheDocument();
  });

  it("promotes a user to admin after confirming", async () => {
    const user = userEvent.setup();
    api.fetchAdminUsers.mockResolvedValueOnce([
      makeAdminUser({ id: "user-2", email: MEMBER_EMAIL, role: "user" }),
    ]);
    api.updateAdminUser.mockResolvedValueOnce(
      makeAdminUser({ id: "user-2", email: MEMBER_EMAIL, role: "admin" }),
    );

    render(<AdminUsersPage />);

    await screen.findAllByText(MEMBER_EMAIL);
    await user.click(screen.getByRole("button", { name: /make admin/i }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(api.updateAdminUser).toHaveBeenCalledWith("test-token", "user-2", { role: "admin" });
    });
  });

  it("disables demote and deactivate for the last active admin (red-green for PR #35 report)", async () => {
    api.fetchAdminUsers.mockResolvedValueOnce([
      makeAdminUser({ id: "user-1", email: ADMIN_EMAIL, role: "admin" }),
      makeAdminUser({ id: "user-2", email: MEMBER_EMAIL, role: "user" }),
    ]);

    render(<AdminUsersPage />);
    await screen.findAllByText(ADMIN_EMAIL);

    // The sole active admin's destructive actions are disabled up front,
    // mirroring the API's last-admin invariant instead of failing on click.
    expect(screen.getByRole("button", { name: "Demote to user" })).toBeDisabled();
    const deactivateButtons = screen.getAllByRole("button", { name: "Deactivate" });
    expect(deactivateButtons[0]).toBeDisabled();
    // The plain member's actions stay enabled.
    expect(screen.getByRole("button", { name: "Make admin" })).toBeEnabled();
    expect(deactivateButtons[1]).toBeEnabled();
  });

  it("keeps demote enabled when another active admin exists", async () => {
    api.fetchAdminUsers.mockResolvedValueOnce([
      makeAdminUser({ id: "user-1", email: ADMIN_EMAIL, role: "admin" }),
      makeAdminUser({ id: "user-2", email: MEMBER_EMAIL, role: "admin" }),
    ]);

    render(<AdminUsersPage />);
    await screen.findAllByText(ADMIN_EMAIL);

    for (const button of screen.getAllByRole("button", { name: "Demote to user" })) {
      expect(button).toBeEnabled();
    }
  });

  it("surfaces a load failure in the alert region", async () => {
    api.fetchAdminUsers.mockRejectedValueOnce(new Error("Unable to load users."));

    render(<AdminUsersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load users.");
  });
});
