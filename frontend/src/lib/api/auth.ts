import { apiFetch, API_BASE_URL, parseError } from "@/lib/api/client";

import type { RunSettingsSectionKey, User } from "@/lib/types";

interface LoginResponse {
  access_token: string;
  token_type: string;
}

export async function loginRequest(
  email: string,
  password: string,
  rememberMe = false,
): Promise<LoginResponse> {
  const body = new URLSearchParams();
  body.append("username", email);
  body.append("password", password);
  body.append("grant_type", "password");
  body.append("scope", "");
  body.append("client_id", "");
  body.append("client_secret", "");
  body.append("remember_me", String(rememberMe));

  const response = await fetch(`${API_BASE_URL}/api/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    credentials: "include",
  });

  if (!response.ok) {
    const data = await parseError(response);
    throw new Error(data?.detail || "Unable to sign in.");
  }

  return response.json();
}

export async function refreshSession(): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
}

export async function logoutRequest(): Promise<void> {
  return apiFetch<void>("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}

export async function registerUser(payload: {
  email: string;
  password: string;
  full_name?: string;
}): Promise<User> {
  return apiFetch<User>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getProfile(token: string): Promise<User> {
  return apiFetch<User>("/api/auth/me", { token });
}

export async function updateUserSettings(
  token: string,
  payload: {
    run_settings_order?: RunSettingsSectionKey[];
    remember_session_days?: 30 | 90 | 180;
  },
): Promise<User> {
  return apiFetch<User>("/api/auth/me", {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function listAuthSessions(
  token: string,
): Promise<import("@/lib/types").AuthSession[]> {
  return apiFetch("/api/auth/sessions", { token, credentials: "include" });
}

export async function revokeAuthSession(token: string, sessionId: string): Promise<void> {
  return apiFetch(`/api/auth/sessions/${sessionId}`, { method: "DELETE", token });
}

export async function revokeAllAuthSessions(token: string): Promise<void> {
  return apiFetch("/api/auth/sessions", { method: "DELETE", token, credentials: "include" });
}

export async function updateRunSettingsOrder(
  token: string,
  order: RunSettingsSectionKey[],
): Promise<User> {
  return updateUserSettings(token, { run_settings_order: order });
}
