import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ViewportRefit } from "@/components/pipelines/flow/ViewportRefit";

const fitView = vi.fn();
let measuredCount = 2;

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ fitView }),
  useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) =>
    selector({
      nodeLookup: new Map(Array.from({ length: measuredCount }, (_, i) => [`${i}`, {}])),
    }),
}));

describe("ViewportRefit", () => {
  beforeEach(() => {
    fitView.mockClear();
    measuredCount = 2;
  });

  it("refits when the key changes, and not on an unrelated re-render", () => {
    const { rerender } = render(<ViewportRefit fitKey="retrieval" padding={0.18} />);
    expect(fitView).toHaveBeenCalledTimes(1);

    rerender(<ViewportRefit fitKey="retrieval" padding={0.18} />);
    expect(fitView).toHaveBeenCalledTimes(1);

    rerender(<ViewportRefit fitKey="origin" padding={0.18} />);
    expect(fitView).toHaveBeenCalledTimes(2);
    expect(fitView).toHaveBeenLastCalledWith({ padding: 0.18, maxZoom: 1 });
  });

  it("waits for the new nodes to be measured before fitting", () => {
    measuredCount = 0;
    const { rerender } = render(<ViewportRefit fitKey="origin" padding={0.2} />);
    expect(fitView).not.toHaveBeenCalled();

    measuredCount = 3;
    rerender(<ViewportRefit fitKey="origin" padding={0.2} />);
    expect(fitView).toHaveBeenCalledTimes(1);
  });
});
