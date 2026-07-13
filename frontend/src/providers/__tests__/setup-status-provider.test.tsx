import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSetupStatus } from "@/lib/api";
import { SetupStatusProvider, useSetupStatus } from "@/providers/setup-status-provider";
import { resetMockAuth } from "@/test/mocks";
import { getMockRouter, setMockPathname } from "@/test/test-utils";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const statusMock = vi.mocked(fetchSetupStatus);

const incomplete = {
  has_embedding_provider: false,
  has_chat_provider: false,
  has_vector_store: true,
  has_index: false,
  has_collection: false,
  setup_complete: false,
};

function Probe() {
  const { status, markComplete } = useSetupStatus();
  return (
    <button onClick={markComplete}>{status ? String(status.setup_complete) : "loading"}</button>
  );
}

describe("SetupStatusProvider", () => {
  beforeEach(() => {
    resetMockAuth();
  });

  it("redirects an incomplete-setup user to /setup from console routes", async () => {
    statusMock.mockResolvedValueOnce(incomplete);
    setMockPathname("/dashboard");

    render(
      <SetupStatusProvider>
        <Probe />
      </SetupStatusProvider>,
    );

    await waitFor(() => expect(getMockRouter().replace).toHaveBeenCalledWith("/setup"));
  });

  it.each(["/setup", "/settings"])("never redirects away from %s", async (pathname) => {
    statusMock.mockResolvedValueOnce(incomplete);
    setMockPathname(pathname);

    render(
      <SetupStatusProvider>
        <Probe />
      </SetupStatusProvider>,
    );

    await screen.findByText("false");
    expect(getMockRouter().replace).not.toHaveBeenCalled();
  });

  it("does not redirect when setup is complete", async () => {
    setMockPathname("/dashboard");

    render(
      <SetupStatusProvider>
        <Probe />
      </SetupStatusProvider>,
    );

    await screen.findByText("true");
    expect(getMockRouter().replace).not.toHaveBeenCalled();
  });

  it("markComplete flips an incomplete status so the gate releases", async () => {
    statusMock.mockResolvedValueOnce(incomplete);
    setMockPathname("/setup");

    render(
      <SetupStatusProvider>
        <Probe />
      </SetupStatusProvider>,
    );
    const button = await screen.findByText("false");
    await act(async () => {
      button.click();
    });

    expect(await screen.findByText("true")).toBeInTheDocument();
  });
});
