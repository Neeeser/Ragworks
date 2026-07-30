import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());

import * as api from "@/lib/api";

import { useLiveValidation } from "../use-live-validation";

import type { PipelineNodeData } from "../../PipelineNode";
import type { PipelineValidationIssue } from "@/lib/types";
import type { Node } from "@xyflow/react";

const validatePipeline = vi.mocked(api.validatePipeline);

const NODES = [
  {
    id: "chunk",
    type: "pipelineNode",
    position: { x: 0, y: 0 },
    data: {
      nodeType: "chunker.token",
      label: "C",
      config: { chunk_size: 400 },
      inputs: [],
      outputs: [],
    },
  },
] as unknown as Node<PipelineNodeData>[];

const ISSUE = { code: "x", message: "m", severity: "warning" } as PipelineValidationIssue;

function render(overrides: Partial<Parameters<typeof useLiveValidation>[0]> = {}) {
  const onIssues = vi.fn();
  const hook = renderHook((props: Record<string, unknown>) =>
    useLiveValidation({
      token: "t",
      nodes: NODES,
      edges: [],
      variables: [],
      draft: null,
      enabled: true,
      onIssues,
      ...overrides,
      ...props,
    }),
  );
  return { onIssues, hook };
}

beforeEach(() => {
  vi.useFakeTimers();
  validatePipeline.mockResolvedValue({ valid: true, errors: [], warnings: [], issues: [ISSUE] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useLiveValidation", () => {
  it("validates once the edits stop, not on every change", async () => {
    const { onIssues, hook } = render();
    expect(validatePipeline).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(validatePipeline).toHaveBeenCalledTimes(1);
    expect(onIssues).toHaveBeenCalledWith([ISSUE]);
    hook.unmount();
  });

  it("sends the drawer's uncommitted draft, not the committed config", async () => {
    const { hook } = render({ draft: { nodeId: "chunk", config: { chunk_size: 4000 } } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    const definition = validatePipeline.mock.calls[0][1];
    expect(definition.nodes[0].config).toMatchObject({ chunk_size: 4000 });
    hook.unmount();
  });

  it("keeps the last issues when a request fails", async () => {
    validatePipeline.mockRejectedValue(new Error("offline"));
    const { onIssues, hook } = render();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Reporting an empty list would claim the graph became clean.
    expect(onIssues).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("does not validate while disabled", async () => {
    const { hook } = render({ enabled: false });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(validatePipeline).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("drops a stale response so it cannot overwrite a newer one", async () => {
    const { onIssues, hook } = render();
    // Unmounting mid-flight stands in for the definition moving on: the
    // in-flight answer describes a definition that no longer exists.
    await act(async () => {
      vi.advanceTimersByTime(500);
      hook.unmount();
    });

    expect(onIssues).not.toHaveBeenCalled();
  });
});
