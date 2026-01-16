import "@testing-library/jest-dom";
import React from "react";
import { beforeEach, vi } from "vitest";

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

type NavigationState = {
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string | string[]>;
  router: {
    push: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    prefetch: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
};

class MockResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const measuredRect = target.getBoundingClientRect?.();
    const rect = measuredRect ?? {
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      toJSON: () => ({}),
    };
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    const entry = {
      target,
      contentRect: {
        ...rect,
        width,
        height,
      },
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

const createMockRouter = () => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
});

const navigationState: NavigationState = {
  pathname: "/",
  searchParams: new URLSearchParams(),
  params: {},
  router: createMockRouter(),
};
const redirectMock = vi.fn((path: string) => {
  throw new Error(`Redirect: ${path}`);
});

Object.defineProperty(globalThis, "__navigation", {
  value: navigationState,
  writable: false,
});
Object.defineProperty(globalThis, "__redirect", {
  value: redirectMock,
  writable: false,
});

beforeEach(() => {
  navigationState.pathname = "/";
  navigationState.searchParams = new URLSearchParams();
  navigationState.params = {};
  navigationState.router = createMockRouter();
  redirectMock.mockReset();
});

vi.mock("next/navigation", () => ({
  useRouter: () => navigationState.router,
  usePathname: () => navigationState.pathname,
  useSearchParams: () => navigationState.searchParams,
  useParams: () => navigationState.params,
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/dynamic", () => ({
  default:
    (_loader: unknown, options?: { loading?: () => React.ReactNode }) =>
    (props: Record<string, unknown>) => {
      const loading = options?.loading?.();
      return React.createElement("div", { "data-testid": "dynamic", ...props }, loading);
    },
}));

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

if (!globalThis.crypto) {
  globalThis.crypto = {
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
  } as Crypto;
} else if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";
}

globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  window.setTimeout(() => callback(Date.now()), 0);

globalThis.cancelAnimationFrame = (handle: number) => {
  window.clearTimeout(handle);
};

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLAnchorElement.prototype, "click", {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: vi.fn(() => "blob:mock"),
});

Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: vi.fn(),
});
