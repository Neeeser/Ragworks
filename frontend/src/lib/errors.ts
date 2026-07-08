/**
 * Formats a per-field error detail (`{field: message}`, as raised by backend
 * `InvalidInputError`) into readable "field: message" lines. A plain string
 * detail passes through unchanged.
 */
export function formatApiErrorDetail(detail: string | Record<string, string>): string {
  if (typeof detail === "string") {
    return detail;
  }
  return Object.entries(detail)
    .map(([field, message]) => `${field}: ${message}`)
    .join("\n");
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

/** True for the DOMException a fetch/stream throws when its AbortController fires. */
export const isAbortError = (value: unknown): value is DOMException =>
  value instanceof DOMException && value.name === "AbortError";
