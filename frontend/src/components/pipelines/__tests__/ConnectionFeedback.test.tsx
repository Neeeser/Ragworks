import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionFeedback } from "@/components/pipelines/ConnectionFeedback";

import type { ConnectionFeedbackNotice } from "@/components/pipelines/ConnectionFeedback";

const notice = (overrides: Partial<ConnectionFeedbackNotice> = {}): ConnectionFeedbackNotice => ({
  tone: "error",
  message: "Cannot connect items to text.",
  at: { x: 120, y: 240 },
  key: 1,
  ...overrides,
});

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe("ConnectionFeedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dismisses itself once the notice has been readable for five seconds", async () => {
    const onDismiss = vi.fn();
    render(<ConnectionFeedback notice={notice()} onDismiss={onDismiss} />);

    await advance(4999);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps counting down across re-renders that hand it a new dismiss callback", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<ConnectionFeedback notice={notice()} onDismiss={onDismiss} />);

    // The editor re-renders constantly while a graph is being edited, and a
    // parent passing an inline arrow hands over a fresh identity each time.
    for (let tick = 0; tick < 5; tick += 1) {
      await advance(1000);
      rerender(<ConnectionFeedback notice={notice()} onDismiss={() => onDismiss()} />);
    }

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("restarts the countdown when a repeat refusal arrives", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<ConnectionFeedback notice={notice()} onDismiss={onDismiss} />);

    await advance(4000);
    rerender(<ConnectionFeedback notice={notice({ key: 2 })} onDismiss={onDismiss} />);
    await advance(4000);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(1000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses as soon as the pointer goes down anywhere", async () => {
    const onDismiss = vi.fn();
    render(<ConnectionFeedback notice={notice()} onDismiss={onDismiss} />);

    await act(async () => {
      fireEvent.pointerDown(window);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing, and starts no timer, without a notice", async () => {
    const onDismiss = vi.fn();
    render(<ConnectionFeedback notice={null} onDismiss={onDismiss} />);

    expect(screen.queryByRole("status")).toBeNull();
    await advance(6000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("positions below the drop point, and centres over the canvas without one", () => {
    const { rerender } = render(<ConnectionFeedback notice={notice()} onDismiss={vi.fn()} />);

    const atDrop = screen.getByRole("status");
    expect(atDrop.style.left).toBe("120px");
    expect(atDrop.style.top).toBe("256px");

    rerender(<ConnectionFeedback notice={notice({ at: null, key: 2 })} onDismiss={vi.fn()} />);
    const centred = screen.getByRole("status");
    expect(centred.style.left).toBe("");
    expect(centred.className).toContain("left-1/2");
  });

  it("marks a warning apart from a refusal", () => {
    const { rerender } = render(
      <ConnectionFeedback notice={notice({ tone: "warning" })} onDismiss={vi.fn()} />,
    );
    expect(screen.getByRole("status").querySelector("svg")?.getAttribute("class")).toContain(
      "text-data-warn",
    );

    rerender(<ConnectionFeedback notice={notice({ key: 2 })} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status").querySelector("svg")?.getAttribute("class")).toContain(
      "text-data-neg",
    );
  });

  it("shows the fix alongside the refusal when the feedback carries one", () => {
    render(
      <ConnectionFeedback
        notice={notice({ fix: "Add an embedder before the index." })}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Cannot connect items to text.")).toBeInTheDocument();
    expect(screen.getByText("Add an embedder before the index.")).toBeInTheDocument();
  });
});
