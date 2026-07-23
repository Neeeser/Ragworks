/**
 * Correlation-ID generation for outbound API requests.
 *
 * The frontend mints a request ID per API call and sends it as `X-Request-ID`;
 * the backend honors a valid UUID and returns it so a user-facing failure can
 * carry a support reference that ties to backend logs. This is correlation
 * only — no analytics, no user tracking.
 */

export const REQUEST_ID_HEADER = "X-Request-ID";

/** Generate a fresh request ID (UUID v4 where the platform provides it). */
export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID; not cryptographic,
  // only needs to be unique enough to correlate one request.
  return `req-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
