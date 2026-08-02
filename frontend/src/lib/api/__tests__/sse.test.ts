/**
 * The shared SSE framing. Every stream in the app reads through this, so
 * the rules it encodes — CRLF normalization, events split on a blank line,
 * `[DONE]` ending the stream, a malformed frame skipped rather than fatal —
 * are pinned here rather than re-derived per caller.
 */

import { describe, expect, it, vi } from "vitest";

import { readSseEvents } from "../sse";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(stream: ReadableStream<Uint8Array>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of readSseEvents<T>(stream)) events.push(event);
  return events;
}

describe("readSseEvents", () => {
  it("parses events split across chunk boundaries", async () => {
    const events = await collect<{ n: number }>(
      streamOf('data: {"n": 1}\n\ndata: {"n"', ": 2}\n\n"),
    );
    expect(events).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("stops at the [DONE] sentinel and ignores anything after it", async () => {
    const events = await collect<{ n: number }>(
      streamOf('data: {"n": 1}\n\ndata: [DONE]\n\ndata: {"n": 2}\n\n'),
    );
    expect(events).toEqual([{ n: 1 }]);
  });

  it("skips a malformed frame instead of ending the stream", async () => {
    const events = await collect<{ n: number }>(streamOf('data: {oops\n\ndata: {"n": 7}\n\n'));
    expect(events).toEqual([{ n: 7 }]);
  });

  it("normalizes CRLF framing", async () => {
    const events = await collect<{ n: number }>(streamOf('data: {"n": 3}\r\n\r\n'));
    expect(events).toEqual([{ n: 3 }]);
  });

  it("cancels a still-open stream when the consumer stops early", async () => {
    // Never closed: a consumer that breaks out mid-stream (an aborted run,
    // an unmounted panel) must release the body rather than leave it open.
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"n": 1}\n\n'));
      },
      cancel,
    });
    for await (const _event of readSseEvents<{ n: number }>(stream)) break;
    expect(cancel).toHaveBeenCalled();
  });
});
