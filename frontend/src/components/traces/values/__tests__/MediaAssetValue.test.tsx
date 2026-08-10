import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TraceValueView } from "@/components/traces/values/TraceValueView";
import { fetchEvalDatasetAssetBlob } from "@/lib/api";

vi.mock("@/lib/api", async () => (await import("@/test/mocks")).mockApi());
vi.mock("@/providers/auth-provider", async () => (await import("@/test/mocks")).mockAuth());

const QUERY_IMAGE = {
  media_type: "image/png",
  path: "eval_datasets/ds-1/queries/q1.png",
  byte_size: 2048,
  width: 640,
  height: 480,
};

describe("media asset trace values", () => {
  it("renders a stored media reference as a thumbnail fetched from its own scope", async () => {
    global.URL.createObjectURL = vi.fn(() => "blob:asset");
    global.URL.revokeObjectURL = vi.fn();

    await act(async () => {
      render(<TraceValueView value={QUERY_IMAGE} kind="json" />);
    });

    // The scope comes from the path, since a value renderer sits below any
    // collection or dataset context.
    expect(vi.mocked(fetchEvalDatasetAssetBlob)).toHaveBeenCalledWith(
      "test-token",
      "ds-1",
      QUERY_IMAGE.path,
    );
    expect(screen.getByRole("img", { name: "Query image" })).toHaveAttribute("src", "blob:asset");
    expect(screen.getByText("640×480")).toBeInTheDocument();
  });

  it("states the type and size for a path under no reachable scope", async () => {
    await act(async () => {
      render(<TraceValueView value={{ ...QUERY_IMAGE, path: "somewhere/else.png" }} kind="json" />);
    });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("image/png")).toBeInTheDocument();
  });
});
