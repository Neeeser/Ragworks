import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SignInPage from "@/app/auth/sign-in/page";
import { makePublicConfig } from "@/test/fixtures";
import { resetMockAppConfig, setMockAppConfig, setMockAuth } from "@/test/mocks";
import { getMockRouter } from "@/test/test-utils";

const loginEmail = "user@example.com";
const loginPassword = "password123";
const emailLabel = "Email";
const passwordLabel = "Password";
const enterDashboardLabel = "Enter dashboard";
const createWorkspaceLabel = "Create workspace";
const needAnAccountText = "Need an account?";

vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());
vi.mock("@/providers/config-provider", async () => (await import("@/test/mocks")).mockAppConfig());
vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

describe("SignInPage", () => {
  let auth: ReturnType<typeof setMockAuth>;

  beforeEach(() => {
    auth = setMockAuth();
    resetMockAppConfig();
  });

  it("submits login and redirects", async () => {
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(emailLabel), { target: { value: loginEmail } });
    fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enterDashboardLabel }));
    });

    expect(auth.signIn).toHaveBeenCalledWith(loginEmail, loginPassword);
    expect(getMockRouter().push).toHaveBeenCalledWith("/dashboard");
  });

  it("handles registration flow and toggles back to login", async () => {
    render(<SignInPage />);

    fireEvent.click(screen.getByText(needAnAccountText));
    fireEvent.change(screen.getByLabelText(emailLabel), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: createWorkspaceLabel }));
    });

    await waitFor(() => {
      expect(screen.getByText("Workspace created. You can sign in now.")).toBeInTheDocument();
    });
    expect(screen.getByText(enterDashboardLabel)).toBeInTheDocument();
  });

  it("shows errors when submit fails", async () => {
    auth.signIn.mockRejectedValueOnce(new Error("Failed"));
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(emailLabel), { target: { value: loginEmail } });
    fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enterDashboardLabel }));
    });

    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows fallback errors and toggles modes", async () => {
    auth.signIn.mockRejectedValueOnce("Failed");
    render(<SignInPage />);

    fireEvent.click(screen.getByText(needAnAccountText));
    expect(screen.getByRole("button", { name: createWorkspaceLabel })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Already have access?"));
    expect(screen.getByText(enterDashboardLabel)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(emailLabel), { target: { value: loginEmail } });
    fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enterDashboardLabel }));
    });

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });

  it("hides the create-account link when registration is disabled", () => {
    setMockAppConfig({ config: makePublicConfig({ auth: { allow_registration: false } }) });
    render(<SignInPage />);

    expect(screen.queryByText(needAnAccountText)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: enterDashboardLabel })).toBeInTheDocument();
  });

  it("shows the create-account link when registration is enabled", () => {
    render(<SignInPage />);

    expect(screen.getByText(needAnAccountText)).toBeInTheDocument();
  });
});
