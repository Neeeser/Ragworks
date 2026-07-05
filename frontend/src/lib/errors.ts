export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

/** True for the DOMException a fetch/stream throws when its AbortController fires. */
export const isAbortError = (value: unknown): value is DOMException =>
  value instanceof DOMException && value.name === "AbortError";
