import { ApiError } from "@/lib/api-error";
import { formatApiErrorDetail } from "@/lib/errors";

// Falls back to same-origin relative paths ("") so the prebuilt Docker image
// works behind any host; the Next server proxies /api/* via API_PROXY_TARGET.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

export type FetchOptions = RequestInit & { token?: string; signal?: AbortSignal };

export async function parseError(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...rest } = options;
  const headers = new Headers(rest.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (rest.body && !(rest.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorData = await parseError(response);
    const detail = errorData?.detail || response.statusText || "Request failed";
    throw new ApiError(response.status, formatApiErrorDetail(detail));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
