/**
 * Reading a `text/event-stream` body as parsed events.
 *
 * The framing rules (CRLF normalization, `\n\n` boundaries, the `data:`
 * line, the `[DONE]` sentinel, cancelling the reader on the way out) are
 * the same for every stream this app opens — a second hand-rolled copy is
 * where one of them silently goes missing.
 */

/** Yield each `data:` payload parsed as JSON; ends on the `[DONE]` sentinel. */
export async function* readSseEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        const dataLine = rawEvent
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") return;
        try {
          yield JSON.parse(payload) as T;
        } catch {
          // A malformed frame is skipped rather than killing the stream.
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore cancellation errors
    }
  }
}
