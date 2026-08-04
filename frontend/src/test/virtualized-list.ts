/**
 * Support for testing `@tanstack/react-virtual` lists under jsdom.
 *
 * jsdom performs no layout, so every element's `offsetHeight` is 0 — and
 * `@tanstack/virtual-core` treats a zero-height scroll container as no
 * viewport at all: `calculateRange` short-circuits `outerSize === 0` to a
 * null range and renders nothing, regardless of how few items the list
 * holds. Any test that renders a virtualized list needs its scroll
 * container's height stubbed, even one asserting on a single row.
 */
export function stubElementHeights(rules: { selector: string; height: number }[]): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      for (const rule of rules) {
        if (this.matches(rule.selector)) {
          return rule.height;
        }
      }
      // jsdom's own getter is untyped as `any`; `offsetHeight` is always a number.
      return original?.get ? (original.get.call(this) as number) : 0;
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
    }
  };
}

/** The Files page's scroll container — every row virtualizer measures its
 * viewport against this element (`FilesBrowser`'s "Folder contents" section,
 * shared with `FileGridView`). */
export const FILES_SCROLL_CONTAINER_SELECTOR = '[aria-label="Folder contents"]';

/**
 * Gives the Files page's scroll container a real viewport height so its
 * virtualized row list renders at all. Any test rendering `FilesBrowser` or
 * `FileListView` in list mode needs this — even one asserting on a single
 * row, since a zero-height container renders none.
 */
export function stubFilesScrollViewport(height = 640): () => void {
  return stubElementHeights([{ selector: FILES_SCROLL_CONTAINER_SELECTOR, height }]);
}
