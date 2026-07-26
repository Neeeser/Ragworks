import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { useNavCollapsed } from "@/components/ui/use-nav-collapsed";

const NARROW_QUERY = "(max-width: 1023px)";

/** Point `matchMedia` at a viewport width, the way the browser reports it. */
function setViewportNarrow(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === NARROW_QUERY ? narrow : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function Harness() {
  const [collapsed, setCollapsed] = useNavCollapsed();
  return (
    <button type="button" onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? "collapsed" : "expanded"}
    </button>
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe("useNavCollapsed", () => {
  it("defaults to the icon rail below lg and to labels above it", () => {
    setViewportNarrow(true);
    const { unmount } = render(<Harness />);
    // An expanded 184px sidebar eats half a 375px phone screen on every page.
    expect(screen.getByRole("button")).toHaveTextContent("collapsed");
    unmount();

    setViewportNarrow(false);
    render(<Harness />);
    expect(screen.getByRole("button")).toHaveTextContent("expanded");
  });

  it("keeps an explicit expand on a narrow viewport", async () => {
    const user = userEvent.setup();
    setViewportNarrow(true);
    const { unmount } = render(<Harness />);

    await act(async () => {
      await user.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button")).toHaveTextContent("expanded");

    // The stored choice outlives the mount — the width default only applies
    // while the user has never chosen.
    unmount();
    render(<Harness />);
    expect(screen.getByRole("button")).toHaveTextContent("expanded");
  });
});
