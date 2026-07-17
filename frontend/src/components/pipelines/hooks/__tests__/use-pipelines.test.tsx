import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePipelines } from "@/components/pipelines/hooks/use-pipelines";
import * as apiModule from "@/lib/api";
import { makeNodeSpec, makePipeline } from "@/test/fixtures";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

const api = vi.mocked(apiModule);

describe("usePipelines background reloads", () => {
  beforeEach(() => {
    api.fetchPipelines.mockReset();
    api.fetchPipelineNodes.mockReset();
    api.fetchCollections.mockReset();
    api.listPipelineVersions.mockReset();
    // Fresh arrays/objects per call, like real fetches — identity preservation
    // must come from the hook, not from the mock returning the same reference.
    api.fetchPipelines.mockImplementation(async () => [
      makePipeline({ id: "pipe-a", name: "A" }),
      makePipeline({ id: "pipe-b", name: "B" }),
    ]);
    api.fetchPipelineNodes.mockImplementation(async () => [makeNodeSpec()]);
    api.fetchCollections.mockImplementation(async () => []);
    api.listPipelineVersions.mockImplementation(async () => []);
  });

  it("keeps the user's selected pipeline when a token refresh reloads the catalog", async () => {
    // The auth provider rotates the JWT every 12 minutes; that reload must not
    // yank the user back to the first pipeline in the list mid-edit.
    const hook = renderHook(({ token }) => usePipelines({ token, kind: "retrieval" }), {
      initialProps: { token: "token-1" },
    });
    await act(async () => Promise.resolve());
    act(() => hook.result.current.setSelectedPipeline(hook.result.current.pipelines[1]));
    expect(hook.result.current.selectedPipeline?.id).toBe("pipe-b");

    hook.rerender({ token: "token-2" });
    await act(async () => Promise.resolve());
    expect(hook.result.current.selectedPipeline?.id).toBe("pipe-b");
  });

  it("preserves nodeSpecs identity when a reload returns unchanged specs", async () => {
    // PipelineBuilder's canvas-seeding effect keys on nodeSpecs; a fresh array
    // identity for identical content reseeds the canvas and wipes unsaved edits.
    const hook = renderHook(({ token }) => usePipelines({ token, kind: "retrieval" }), {
      initialProps: { token: "token-1" },
    });
    await act(async () => Promise.resolve());
    const specsBefore = hook.result.current.nodeSpecs;
    const selectedBefore = hook.result.current.selectedPipeline;

    hook.rerender({ token: "token-2" });
    await act(async () => Promise.resolve());
    expect(hook.result.current.nodeSpecs).toBe(specsBefore);
    expect(hook.result.current.selectedPipeline).toBe(selectedBefore);
  });

  it("reloads silently once the catalog has loaded", async () => {
    // Flipping `loading` on a background reload unmounts the whole editor
    // (canvas, node dialog) behind a spinner mid-edit.
    const hook = renderHook(({ token }) => usePipelines({ token, kind: "retrieval" }), {
      initialProps: { token: "token-1" },
    });
    await act(async () => Promise.resolve());
    expect(hook.result.current.loading).toBe(false);

    hook.rerender({ token: "token-2" });
    expect(hook.result.current.loading).toBe(false);
    await act(async () => Promise.resolve());
  });
});
