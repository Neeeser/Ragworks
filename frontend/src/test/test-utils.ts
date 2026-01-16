import type { Mock } from "vitest";

type NavigationState = {
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string | string[]>;
  router: {
    push: Mock;
    replace: Mock;
    prefetch: Mock;
    refresh: Mock;
  };
};

const getNavigationState = () =>
  (globalThis as unknown as { __navigation: NavigationState }).__navigation;

export const setMockPathname = (pathname: string) => {
  getNavigationState().pathname = pathname;
};

export const setMockSearchParams = (value: string) => {
  getNavigationState().searchParams = new URLSearchParams(value);
};

export const setMockParams = (params: Record<string, string | string[]>) => {
  getNavigationState().params = params;
};

export const getMockRouter = () => getNavigationState().router;

export const getMockSearchParams = () => getNavigationState().searchParams;

export const getMockRedirect = () => (globalThis as unknown as { __redirect: Mock }).__redirect;
