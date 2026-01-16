import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SignInPage from "@/app/auth/sign-in/page";
import { getMockRouter } from "@/test/test-utils";

const api = {
  registerUser: vi.fn(),
};

const auth = {
  signIn: vi.fn(),
  loading: false,
};

const loginEmail = "user@example.com";
const loginPassword = "password123";
const loginInputsError = "Login inputs not found";
const registrationInputsError = "Registration inputs not found";
const emailSelector = 'input[type="email"]';
const passwordSelector = 'input[type="password"]';
const enterDashboardLabel = "Enter dashboard";

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => auth,
}));

vi.mock("@/lib/api", () => ({
  registerUser: (...args: unknown[]) => api.registerUser(...args),
}));

describe("SignInPage", () => {
  it("submits login and redirects", async () => {
    auth.signIn.mockResolvedValueOnce(undefined);
    render(<SignInPage />);

    const emailInput = document.querySelector(emailSelector);
    const passwordInput = document.querySelector(passwordSelector);
    if (!emailInput || !passwordInput) {
      throw new Error(loginInputsError);
    }
    fireEvent.change(emailInput, { target: { value: loginEmail } });
    fireEvent.change(passwordInput, { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enterDashboardLabel }));
    });

    expect(auth.signIn).toHaveBeenCalledWith(loginEmail, loginPassword);
    expect(getMockRouter().push).toHaveBeenCalledWith("/dashboard");
  });

  it("handles registration flow and toggles back to login", async () => {
    api.registerUser.mockResolvedValueOnce({ id: "user-1" });
    render(<SignInPage />);

    fireEvent.click(screen.getByText("Need an account?"));
    const emailInput = document.querySelector(emailSelector);
    const nameInput = document.querySelector('input[type="text"]');
    const passwordInput = document.querySelector(passwordSelector);
    if (!emailInput || !nameInput || !passwordInput) {
      throw new Error(registrationInputsError);
    }
    fireEvent.change(emailInput, { target: { value: "new@example.com" } });
    fireEvent.change(nameInput, { target: { value: "New User" } });
    fireEvent.change(passwordInput, { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Workspace created. You can sign in now.")).toBeInTheDocument();
    });
    expect(screen.getByText(enterDashboardLabel)).toBeInTheDocument();
  });

  it("shows errors when submit fails", async () => {
    auth.signIn.mockRejectedValueOnce(new Error("Failed"));
    render(<SignInPage />);

    const emailInput = document.querySelector(emailSelector);
    const passwordInput = document.querySelector(passwordSelector);
    if (!emailInput || !passwordInput) {
      throw new Error(loginInputsError);
    }
    fireEvent.change(emailInput, { target: { value: loginEmail } });
    fireEvent.change(passwordInput, { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enterDashboardLabel }));
    });

    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows fallback errors and toggles modes", async () => {
    auth.signIn.mockRejectedValueOnce("Failed");
    render(<SignInPage />);

    fireEvent.click(screen.getByText("Need an account?"));
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Already have access?"));
    expect(screen.getByText(enterDashboardLabel)).toBeInTheDocument();

    const emailInput = document.querySelector(emailSelector);
    const passwordInput = document.querySelector(passwordSelector);
    if (!emailInput || !passwordInput) {
      throw new Error(loginInputsError);
    }
    fireEvent.change(emailInput, { target: { value: loginEmail } });
    fireEvent.change(passwordInput, { target: { value: loginPassword } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enterDashboardLabel }));
    });

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });
});
