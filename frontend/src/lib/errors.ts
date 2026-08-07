import { type ProviderErrorDetail, isProviderErrorDetail } from "@/lib/types/provider-errors";

/** One entry of FastAPI's 422 validation-error `detail` list. */
interface ValidationErrorItem {
  loc?: unknown[];
  msg?: string;
}

const isValidationErrorItem = (value: unknown): value is ValidationErrorItem =>
  typeof value === "object" && value !== null && "msg" in value;

const hasMessage = (value: unknown): value is { message: string } =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  typeof value.message === "string";

/** Renders a single 422 item as "field.path: message" (dropping the leading "body"). */
function formatValidationErrorItem(item: ValidationErrorItem): string {
  const msg = item.msg ?? "Invalid value";
  const path = (item.loc ?? []).filter((part) => part !== "body").map((part) => String(part));
  return path.length > 0 ? `${path.join(".")}: ${msg}` : msg;
}

/**
 * Formats an API error `detail` into readable lines. Handles the shapes the
 * backend actually returns: a plain string (`ServiceError`), a classified
 * upstream failure (`ProviderError`), a per-field map (`{field: message}`),
 * and FastAPI's 422 validation list (`[{loc, msg, type}]`). The list case
 * previously rendered as "0: [object Object]" because it was treated as a
 * `{field: message}` map.
 */
export function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  // Its `message` is the whole readable sentence; the sibling fields are
  // machine-readable, and the generic object branch below would print them as
  // "code: quota_exhausted / provider: Anthropic / retryable: false".
  if (isProviderErrorDetail(detail)) {
    return detail.message;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (isValidationErrorItem(item)) return formatValidationErrorItem(item);
        if (hasMessage(item)) return item.message;
        return formatApiErrorDetail(item);
      })
      .join("\n");
  }
  if (typeof detail === "object" && detail !== null) {
    return Object.entries(detail as Record<string, unknown>)
      .map(([field, message]) => `${field}: ${formatApiErrorDetail(message)}`)
      .join("\n");
  }
  return String(detail);
}

/**
 * The classified upstream failure behind an error, if it was one.
 *
 * Read from `ApiError.rawDetail` — the formatted `detail` string keeps the
 * sentence but drops the code a surface needs to offer the right action.
 */
export function getProviderError(err: unknown): ProviderErrorDetail | undefined {
  if (typeof err !== "object" || err === null || !("rawDetail" in err)) {
    return undefined;
  }
  const detail = (err as { rawDetail?: unknown }).rawDetail;
  return isProviderErrorDetail(detail) ? detail : undefined;
}

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

/**
 * The backend correlation ID for a failure, if the error carries one. Used to
 * show a support reference a user can copy into a bug report. Imported lazily
 * to avoid a circular import with the api-error module.
 */
export function getRequestId(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "requestId" in err) {
    const value = (err as { requestId?: unknown }).requestId;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** True for the DOMException a fetch/stream throws when its AbortController fires. */
export const isAbortError = (value: unknown): value is DOMException =>
  value instanceof DOMException && value.name === "AbortError";
