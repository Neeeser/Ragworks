import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as apiModule from "@/lib/api";
import { ConfigProvider, useAppConfig } from "@/providers/config-provider";
import { makePublicConfig } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

function ConfigStateView() {
  const { config, loading } = useAppConfig();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="allow_registration">{String(config.auth.allow_registration)}</div>
      <div data-testid="umap">{String(config.features.umap_visualizations)}</div>
      <div data-testid="branching">{String(config.features.chat_branching)}</div>
      <div data-testid="max_upload">{String(config.uploads.max_upload_size_mb)}</div>
    </div>
  );
}

describe("ConfigProvider", () => {
  it("throws when used outside the provider", () => {
    const Problem = () => {
      useAppConfig();
      return <div>nope</div>;
    };
    expect(() => render(<Problem />)).toThrow("useAppConfig must be used within a ConfigProvider");
  });

  it("exposes permissive defaults before the fetch resolves, then updates", async () => {
    let resolveFetch: (value: ReturnType<typeof makePublicConfig>) => void = () => {};
    api.fetchPublicConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      <ConfigProvider>
        <ConfigStateView />
      </ConfigProvider>,
    );

    // Defaults are usable immediately (permissive: everything enabled/open).
    expect(screen.getByTestId("allow_registration")).toHaveTextContent("true");
    expect(screen.getByTestId("umap")).toHaveTextContent("true");
    expect(screen.getByTestId("branching")).toHaveTextContent("true");

    await act(async () => {
      resolveFetch(
        makePublicConfig({
          auth: { allow_registration: false },
          features: { umap_visualizations: false, chat_branching: false },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("allow_registration")).toHaveTextContent("false");
    expect(screen.getByTestId("umap")).toHaveTextContent("false");
    expect(screen.getByTestId("branching")).toHaveTextContent("false");
  });

  it("keeps default config when the fetch rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.fetchPublicConfig.mockRejectedValueOnce(new Error("network down"));

    render(
      <ConfigProvider>
        <ConfigStateView />
      </ConfigProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("allow_registration")).toHaveTextContent("true");
    expect(screen.getByTestId("umap")).toHaveTextContent("true");
    expect(screen.getByTestId("branching")).toHaveTextContent("true");
    expect(screen.getByTestId("max_upload")).toHaveTextContent("50");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
