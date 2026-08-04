import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilesBrowser } from "@/components/files/FilesBrowser";
import * as apiModule from "@/lib/api";
import { makeFileNode, makeFileTree } from "@/test/fixtures";
import { FILES_SCROLL_CONTAINER_SELECTOR, stubElementHeights } from "@/test/virtualized-list";

import type { FileNode } from "@/lib/types";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

const TOKEN = "token-1";
const CONTAINER_LABEL = "Folder contents";

function renderBrowser() {
  return render(
    <FilesBrowser token={TOKEN} collectionId="col-1" collectionName="Docs" pathSegments={[]} />,
  );
}

const FIRST_FILE_NAME = "file-000.txt";
const LAST_FILE_NAME = "file-199.txt";

function manyFileNodes(count: number): FileNode[] {
  return Array.from({ length: count }, (_, index) => {
    const label = String(index).padStart(3, "0");
    return makeFileNode({
      id: `file-${label}`,
      name: `file-${label}.txt`,
      path: `/file-${label}.txt`,
      ingestion: null,
    });
  });
}

/**
 * Stubs the scroll container's viewport height (always required — see
 * `stubElementHeights`'s docstring) and, when given, every rendered row's
 * height (matched by `[data-index]`, the attribute `@tanstack/virtual-core`
 * itself uses to identify a measured row).
 */
function stubUniformRowHeights(viewportHeight: number, rowHeight = 0): () => void {
  return stubElementHeights([
    { selector: FILES_SCROLL_CONTAINER_SELECTOR, height: viewportHeight },
    { selector: "[data-index]", height: rowHeight },
  ]);
}

describe("file list row windowing", () => {
  it("mounts only the rows near the viewport, not the whole folder", async () => {
    const total = 200;
    const viewportHeight = 640;
    const rowHeight = 40;
    const restore = stubUniformRowHeights(viewportHeight, rowHeight);
    api.fetchFileTree.mockResolvedValue(makeFileTree({ nodes: manyFileNodes(total) }));

    try {
      renderBrowser();
      await screen.findByText(FIRST_FILE_NAME);

      const mountedRows = document.querySelectorAll("[data-index]");
      // ~16 rows fit the stubbed viewport, plus overscan on each side — nowhere
      // near the 200 real entries in the folder.
      expect(mountedRows.length).toBeGreaterThan(10);
      expect(mountedRows.length).toBeLessThan(60);
      expect(screen.queryByText(LAST_FILE_NAME)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("swaps which rows are mounted as the container scrolls", async () => {
    const total = 200;
    const viewportHeight = 640;
    const rowHeight = 40;
    const restore = stubUniformRowHeights(viewportHeight, rowHeight);
    api.fetchFileTree.mockResolvedValue(makeFileTree({ nodes: manyFileNodes(total) }));

    try {
      renderBrowser();
      await screen.findByText(FIRST_FILE_NAME);

      const container = screen.getByRole("region", { name: CONTAINER_LABEL });
      // Not `total * rowHeight - viewportHeight`: rows outside the *first*
      // render's window are still at `estimateSize()` until they mount and
      // get measured, so the list's total height is a moving target while
      // scrolling through unmeasured territory. A scroll offset far past any
      // possible total lands at the true end regardless.
      container.scrollTop = total * rowHeight * 10;
      fireEvent.scroll(container);

      await waitFor(() => {
        expect(screen.getByText(LAST_FILE_NAME)).toBeInTheDocument();
      });
      expect(screen.queryByText(FIRST_FILE_NAME)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe("file list row measurement wiring", () => {
  it("gives every rendered row root a real data-index attribute matching its position", async () => {
    // A zero-height scroll container is exactly a null viewport to the
    // virtualizer, which renders no items at all — jsdom never lays anything
    // out, so this alone (not row height, irrelevant to this assertion) has
    // to be stubbed even for a list this small.
    const restore = stubUniformRowHeights(640);
    const names = ["alpha.txt", "bravo.txt", "charlie.txt"];
    const nodes = names.map((name, index) =>
      makeFileNode({ id: `n-${index}`, name, path: `/${name}`, ingestion: null }),
    );
    api.fetchFileTree.mockResolvedValue(makeFileTree({ nodes }));

    try {
      renderBrowser();
      await screen.findByText("charlie.txt");

      // Small list, well inside the default overscan, so every entry mounts —
      // this asserts the attribute @tanstack/virtual-core reads back off the
      // DOM to resolve which item it just measured
      // (`indexAttribute: "data-index"`). A row missing it, or carrying the
      // wrong value, is exactly the bug class that makes rows overlap or jump.
      for (const [index, name] of names.entries()) {
        const row = screen.getByText(name).closest("li");
        expect(row).not.toBeNull();
        expect(row?.getAttribute("data-index")).toBe(String(index));
      }
    } finally {
      restore();
    }
  });
});

/**
 * Beta's row measures 0 like every other row in jsdom (no real layout) until
 * its disclosure actually opens — mirrored here off `aria-expanded="true"`,
 * the same attribute a real browser's own accessibility tree carries the
 * instant the row expands, so the stub tracks the app's real state rather
 * than asserting a height unconditionally regardless of whether the row is
 * open.
 */
function stubBetaGrowsOnceExpanded(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.matches(FILES_SCROLL_CONTAINER_SELECTOR)) {
        return 640;
      }
      if (this.matches('[data-index="1"]') && this.querySelector('[aria-expanded="true"]')) {
        return 300;
      }
      return 0;
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
    }
  };
}

describe("file list row dynamic remeasurement", () => {
  it("shifts later rows down once a row expands, driven by the real expand interaction alone", async () => {
    // Everything about this test is the real path: a real click, a real
    // async chunk fetch, and the app's own `useLayoutEffect`-driven
    // remeasure — nothing here manually fires a ResizeObserver notification.
    //
    // An earlier version of this test faked that notification directly
    // (`resizeObserver.fire(betaRow)`), which passed while the app was
    // actually broken: a real browser's ResizeObserver never fires for a
    // document that isn't visible to the compositor (a backgrounded tab, or
    // — verified live — this app's own sandboxed browser session), so the
    // real click never triggered any remeasurement at all. Manually firing
    // the callback bypassed exactly the step that was failing. This version
    // exercises the real trigger (the `expanded` state change and the async
    // fetch settling) and would fail again if that trigger regressed.
    const restore = stubBetaGrowsOnceExpanded();
    const user = userEvent.setup();
    const nodes = [
      makeFileNode({ id: "n-alpha", name: "alpha.txt", path: "/alpha.txt", ingestion: null }),
      makeFileNode({ id: "n-beta", name: "beta.txt", path: "/beta.txt" }), // ready, expandable
      makeFileNode({ id: "n-gamma", name: "gamma.txt", path: "/gamma.txt", ingestion: null }),
    ];
    api.fetchFileTree.mockResolvedValue(makeFileTree({ nodes }));

    try {
      renderBrowser();
      await screen.findByText("gamma.txt");

      const gammaRow = screen.getByText("gamma.txt").closest("li");
      if (!(gammaRow instanceof HTMLElement)) {
        throw new Error("no row for gamma.txt");
      }
      // Before beta expands, every row measures 0 in jsdom (no real layout),
      // so gamma — the third row — starts at offset 0 too.
      expect(gammaRow.style.transform).toBe("translateY(0px)");

      await user.click(await screen.findByRole("button", { name: "Show chunks in beta.txt" }));

      // The expand itself (before the chunk fetch resolves) already carries
      // beta's stubbed height, so gamma should shift on this trigger alone.
      await waitFor(() => {
        expect(gammaRow.style.transform).toBe("translateY(300px)");
      });

      // The chunk fetch resolving is a second, independent trigger — confirm
      // it doesn't regress the position once real content has replaced the
      // loading skeleton.
      await screen.findByText("Chunk 00");
      expect(gammaRow.style.transform).toBe("translateY(300px)");
    } finally {
      restore();
    }
  });
});
