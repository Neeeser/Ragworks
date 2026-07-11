import { act, fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUnsavedChangesGuard } from "../use-unsaved-changes-guard";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const COLLECTIONS = "/collections";

/** Appends an anchor that swallows its own default so jsdom never navigates. */
const makeAnchor = (href: string, target?: string) => {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (target) anchor.target = target;
  anchor.addEventListener("click", (event) => event.preventDefault());
  document.body.appendChild(anchor);
  return anchor;
};

describe("useUnsavedChangesGuard", () => {
  beforeEach(() => {
    push.mockClear();
    document.body.innerHTML = "";
  });

  it("runs guarded actions immediately while clean", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(false));
    const action = vi.fn();

    act(() => result.current.guard(action));

    expect(action).toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
  });

  it("stashes guarded actions while dirty until the user confirms", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    const action = vi.fn();

    act(() => result.current.guard(action));
    expect(action).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(true);

    act(() => result.current.confirmDiscard());
    expect(action).toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
  });

  it("drops the stashed action when the user cancels", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    const action = vi.fn();

    act(() => result.current.guard(action));
    act(() => result.current.cancelDiscard());
    act(() => result.current.confirmDiscard());

    expect(action).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
  });

  it("blocks the beforeunload event only while dirty", () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: true },
    });

    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender({ dirty: false });
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it("intercepts in-app link navigation while dirty and resumes it on confirm", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));

    const anchor = makeAnchor(COLLECTIONS);

    fireEvent.click(anchor);
    expect(push).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(true);

    act(() => result.current.confirmDiscard());
    expect(push).toHaveBeenCalledWith(COLLECTIONS);
  });

  it("ignores link clicks while clean, on new-tab links, and on same-page anchors", () => {
    const { result, rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: true },
    });

    const newTab = makeAnchor(COLLECTIONS, "_blank");
    fireEvent.click(newTab);
    expect(result.current.confirmOpen).toBe(false);

    const samePage = makeAnchor(window.location.pathname);
    fireEvent.click(samePage);
    expect(result.current.confirmOpen).toBe(false);

    rerender({ dirty: false });
    const normal = makeAnchor(COLLECTIONS);
    fireEvent.click(normal);
    expect(result.current.confirmOpen).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
