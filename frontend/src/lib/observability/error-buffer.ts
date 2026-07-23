/**
 * In-memory ring of recent client-observed failures for the error report.
 *
 * Records failed API calls and uncaught client errors so a user can download a
 * small diagnostics report to attach to a bug report. It captures correlation
 * metadata only — method, path (query string stripped), status, request ID,
 * and error message/stack — never request bodies, tokens, or response
 * payloads. No data leaves the browser except when the user explicitly
 * downloads the report.
 */

const MAX_ENTRIES = 50;

export interface ObservabilityEntry {
  timestamp: string;
  kind: "api_error" | "client_error";
  method?: string;
  path?: string;
  status?: number;
  requestId?: string;
  message: string;
}

const entries: ObservabilityEntry[] = [];

/** Strip the query string and origin so no id-bearing query params are kept. */
function sanitizePath(path: string): string {
  const withoutQuery = path.split("?")[0].split("#")[0];
  try {
    return new URL(withoutQuery, "http://local").pathname;
  } catch {
    return withoutQuery;
  }
}

function push(entry: ObservabilityEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

/** Record a failed API call. */
export function recordApiError(input: {
  method?: string;
  path: string;
  status: number;
  requestId?: string;
  message: string;
}): void {
  push({
    timestamp: new Date().toISOString(),
    kind: "api_error",
    method: input.method,
    path: sanitizePath(input.path),
    status: input.status,
    requestId: input.requestId,
    message: input.message,
  });
}

/** Record an uncaught client-side error (message + optional stack only). */
export function recordClientError(message: string): void {
  push({ timestamp: new Date().toISOString(), kind: "client_error", message });
}

/** Return a copy of the buffered entries, oldest first. */
export function getObservabilityEntries(): ObservabilityEntry[] {
  return [...entries];
}

/** Clear the buffer (used by tests and after a report is downloaded). */
export function clearObservabilityEntries(): void {
  entries.length = 0;
}

let captureInstalled = false;

/**
 * Install one-time `window` hooks that record uncaught errors and rejections.
 * Idempotent; captures message and stack only, never event payloads.
 */
export function installClientErrorCapture(): void {
  if (captureInstalled || typeof window === "undefined") {
    return;
  }
  captureInstalled = true;
  window.addEventListener("error", (event) => {
    recordClientError(event.message || String(event.error ?? "Unknown error"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordClientError(reason instanceof Error ? reason.message : String(reason));
  });
}
