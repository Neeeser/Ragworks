/**
 * Classified upstream-provider failures.
 * Mirrors `app/schemas/provider_errors.py`.
 *
 * The backend reads each provider's own error code so failures a user can fix
 * are told apart from failures they can only wait out — an exhausted credit
 * balance and a rate limit are both HTTP 429 upstream.
 */

/** What went wrong upstream, in terms the user can act on. */
export type ProviderErrorCode =
  | "quota_exhausted"
  | "rate_limited"
  | "authentication"
  | "permission_denied"
  | "invalid_request"
  | "context_length_exceeded"
  | "payload_too_large"
  | "content_policy"
  | "not_found"
  | "timeout"
  | "unavailable"
  | "server_error"
  | "connection"
  | "unknown";

/** The `detail` body of an HTTP error caused by an upstream provider. */
export interface ProviderErrorDetail {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  provider?: string | null;
  provider_message?: string | null;
  upstream_status?: number | null;
}

/**
 * Codes a user resolves on their provider connection rather than by retrying.
 * Drives the "Manage connections" affordance on failure surfaces.
 */
const CONNECTION_FIXABLE: ReadonlySet<ProviderErrorCode> = new Set([
  "quota_exhausted",
  "authentication",
  "permission_denied",
  "connection",
]);

export const isConnectionFixable = (code: ProviderErrorCode): boolean =>
  CONNECTION_FIXABLE.has(code);

/** Narrow an `ApiError.rawDetail` (or a nested field) to a provider failure. */
export function isProviderErrorDetail(detail: unknown): detail is ProviderErrorDetail {
  if (typeof detail !== "object" || detail === null) return false;
  const candidate = detail as Partial<ProviderErrorDetail>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}
