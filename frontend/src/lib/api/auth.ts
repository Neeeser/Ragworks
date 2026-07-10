import { apiFetch, API_BASE_URL, parseError } from "@/lib/api/client";

import type {
  ProviderKeyStatus,
  RunSettingsSectionKey,
  User,
  UserKeyValidation,
} from "@/lib/types";

interface LoginResponse {
  access_token: string;
  token_type: string;
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const body = new URLSearchParams();
  body.append("username", email);
  body.append("password", password);
  body.append("grant_type", "password");
  body.append("scope", "");
  body.append("client_id", "");
  body.append("client_secret", "");

  const response = await fetch(`${API_BASE_URL}/api/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const data = await parseError(response);
    throw new Error(data?.detail || "Unable to sign in.");
  }

  return response.json();
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
    openrouter_api_key?: string;
    pinecone_api_key?: string;
    run_settings_order?: RunSettingsSectionKey[];
  },
): Promise<User> {
  return apiFetch<User>("/api/auth/me", {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function updateRunSettingsOrder(
  token: string,
  order: RunSettingsSectionKey[],
): Promise<User> {
  return updateUserSettings(token, { run_settings_order: order });
}

export async function validateUserKeys(token: string): Promise<UserKeyValidation> {
  return apiFetch<UserKeyValidation>("/api/auth/me/keys/validate", { token });
}

export async function validateProviderKey(
  token: string,
  provider: "openrouter" | "pinecone",
  apiKey: string,
): Promise<ProviderKeyStatus> {
  return apiFetch<ProviderKeyStatus>("/api/auth/keys/validate", {
    method: "POST",
    token,
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
}
