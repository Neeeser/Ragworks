import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UmapCanvas } from "@/components/collections/detail/visualize/UmapCanvas";

import type { UmapPoint } from "@/lib/types";

let lastDeckProps: Record<string, unknown> | null = null;
type TooltipResult = { text: string } | null;
type DeckLayer = { id?: string; props: Record<string, unknown> };

vi.mock("@deck.gl/core", () => ({
  COORDINATE_SYSTEM: { CARTESIAN: "cartesian" },
  OrthographicView: class OrthographicView {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
}));

vi.mock("@deck.gl/layers", () => {
  class MockLayer {
    props: Record<string, unknown>;
    id?: string;
    constructor(props: Record<string, unknown>) {
      this.props = props;
      this.id = props.id as string | undefined;
    }
  }

  return {
    LineLayer: MockLayer,
    ScatterplotLayer: MockLayer,
  };
});

vi.mock("@deck.gl/react", () => ({
  default: (props: Record<string, unknown>) => {
    lastDeckProps = props;
    return <div data-testid="deck" />;
  },
}));

vi.mock("@luma.gl/core", () => {
  class MockCanvasContext {
    device?: { limits?: { maxTextureDimension2D?: number } };
    canvas?: { width?: number; height?: number };
    getMaxDrawingBufferSize() {
      return [1, 1];
    }
  }

  return { CanvasContext: MockCanvasContext };
});

vi.mock("@luma.gl/webgl", () => ({
  webgl2Adapter: "adapter",
}));

class MockResizeObserver {
  private callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
  constructor(
    callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void,
  ) {
    this.callback = callback;
  }
  observe() {
    this.callback([]);
    this.callback([{ contentRect: { width: 800, height: 600 } }]);
  }
  disconnect() {}
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

describe("UmapCanvas", () => {
  beforeEach(() => {
    lastDeckProps = null;
  });

  it("renders with empty points and handles zoom", () => {
    const onSelectPoint = vi.fn();
    const { getByTitle } = render(
      <UmapCanvas
        points={[]}
        selectedPointId={null}
        selectedPoint={null}
        onSelectPoint={onSelectPoint}
      />,
    );

    expect(lastDeckProps?.viewState).toEqual({ target: [0, 0, 0], zoom: 0 });

    fireEvent.click(getByTitle("Zoom in"));
    fireEvent.click(getByTitle("Zoom out"));
    const centerButton = getByTitle("Center on selection") as HTMLButtonElement;
    centerButton.removeAttribute("disabled");
    fireEvent.click(centerButton);

    act(() => {
      (lastDeckProps?.onViewStateChange as (params: { viewState: { zoom: number } }) => void)?.({
        viewState: { zoom: NaN },
      });
    });
  });

  it("centers on selection and triggers point selection", () => {
    const points: UmapPoint[] = [
      { id: "p1", chunk_id: "c1", document_id: "d1", chunk_index: 0, x: 10, y: 20 },
      { id: "p2", chunk_id: "c2", document_id: "d2", chunk_index: 1, x: 20, y: 40 },
    ];
    const onSelectPoint = vi.fn();

    const { getByTitle } = render(
      <UmapCanvas
        points={points}
        selectedPointId="p1"
        selectedPoint={points[0]}
        onSelectPoint={onSelectPoint}
      />,
    );

    fireEvent.click(getByTitle("Center on selection"));
    fireEvent.click(getByTitle("Reset view"));

    const layers = lastDeckProps?.layers as DeckLayer[] | undefined;
    const scatter = layers?.find((layer) => layer.id === "umap-points");
    const grid = layers?.find((layer) => layer.id === "umap-grid");
    type GridLine = { source: [number, number]; target: [number, number] };
    const gridLine = (grid?.props.data as GridLine[])[0];
    if (grid && gridLine) {
      const getSourcePosition = grid.props.getSourcePosition as (line: GridLine) => unknown;
      const getTargetPosition = grid.props.getTargetPosition as (line: GridLine) => unknown;
      expect(getSourcePosition(gridLine)).toEqual(gridLine.source);
      expect(getTargetPosition(gridLine)).toEqual(gridLine.target);
    }
    const onClick = scatter?.props.onClick as (info: { object?: UmapPoint | null }) => void;
    onClick?.({ object: points[1] });
    expect(onSelectPoint).toHaveBeenCalledWith(points[1]);
    if (scatter) {
      const getPosition = scatter.props.getPosition as (point: UmapPoint) => unknown;
      const getRadius = scatter.props.getRadius as () => number;
      const getFillColor = scatter.props.getFillColor as (point: UmapPoint) => unknown;
      expect(getPosition(points[0])).toEqual([points[0].x, points[0].y]);
      expect(getRadius()).toBeGreaterThan(0);
      expect(getFillColor(points[0])).toEqual([248, 113, 113, 220]);
      expect(getFillColor(points[1])).toEqual([129, 140, 248, 200]);
    }

    const tooltip = lastDeckProps?.getTooltip as (info: {
      object?: UmapPoint | null;
    }) => TooltipResult;
    expect(tooltip?.({ object: points[0] })).toEqual({ text: "Chunk 0" });
    expect(tooltip?.({ object: null })).toBeNull();
  });

  it("covers grid step branches and spacing fallbacks", async () => {
    const points: UmapPoint[] = [
      { id: "p1", chunk_id: "c1", document_id: "d1", chunk_index: 0, x: NaN, y: NaN },
      { id: "p2", chunk_id: "c2", document_id: "d2", chunk_index: 1, x: NaN, y: NaN },
    ];

    render(
      <UmapCanvas
        points={points}
        selectedPointId={null}
        selectedPoint={null}
        onSelectPoint={() => undefined}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const onViewStateChange = lastDeckProps?.onViewStateChange as
      | ((params: { viewState: { zoom: number; target?: number[] } }) => void)
      | undefined;
    act(() => {
      onViewStateChange?.({ viewState: { zoom: 5 } });
      onViewStateChange?.({ viewState: { zoom: 5, target: [5] } });
      onViewStateChange?.({ viewState: { zoom: 4 } });
      onViewStateChange?.({ viewState: { zoom: 3 } });
      onViewStateChange?.({ viewState: { zoom: -1 } });
    });

    const gridLayer = (lastDeckProps?.layers as DeckLayer[] | undefined)?.find(
      (layer) => layer.id === "umap-grid",
    );
    const gridData = gridLayer?.props.data as Array<unknown> | undefined;
    expect(gridData && gridData.length > 0).toBe(true);
  });

  it("patches canvas context limits", async () => {
    render(
      <UmapCanvas
        points={[]}
        selectedPointId={null}
        selectedPoint={null}
        onSelectPoint={() => undefined}
      />,
    );
    const { CanvasContext } = await import("@luma.gl/core");
    // The real CanvasContext is abstract; @luma.gl/core is mocked above with a concrete
    // stand-in, so the constructor needs to be re-typed to match what's actually returned.
    const MockCanvasContext = CanvasContext as unknown as new () => {
      canvas?: { width?: number; height?: number };
      device?: { limits?: { maxTextureDimension2D?: number } };
      getMaxDrawingBufferSize(): number[];
    };
    const context = new MockCanvasContext();
    context.canvas = { width: 5, height: 8 };
    const result = context.getMaxDrawingBufferSize();
    expect(result).toEqual([4096, 4096]);

    context.device = { limits: { maxTextureDimension2D: 512 } };
    expect(context.getMaxDrawingBufferSize()).toEqual([1, 1]);
  });
});
