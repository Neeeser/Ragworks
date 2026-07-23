import { ApiError } from "@/lib/api-error";
import { formatApiErrorDetail } from "@/lib/errors";
import { REQUEST_ID_HEADER, generateRequestId, recordApiError } from "@/lib/observability";

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
  const requestId = generateRequestId();
  headers.set(REQUEST_ID_HEADER, requestId);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorData = await parseError(response);
    const detail = errorData?.detail || response.statusText || "Request failed";
    // Prefer the backend's returned id (set by the request middleware, present
    // even on 500s); fall back to the one we sent so an error always correlates.
    const responseId = response.headers.get(REQUEST_ID_HEADER) ?? requestId;
    const message = formatApiErrorDetail(detail);
    recordApiError({
      method: rest.method ?? "GET",
      path,
      status: response.status,
      requestId: responseId,
      message,
    });
    throw new ApiError(response.status, message, detail, responseId);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
