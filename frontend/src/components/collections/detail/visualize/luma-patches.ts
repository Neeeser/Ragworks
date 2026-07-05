import { CanvasContext } from "@luma.gl/core";

const DEFAULT_LIMIT_FALLBACK = 4096;

// Guard against ResizeObserver running before the WebGL device limits are ready:
// `CanvasContext.getMaxDrawingBufferSize` can be called by luma.gl's resize handling
// before `this.device.limits` is populated, which throws when the real implementation
// tries to read `maxTextureDimension2D` off an undefined `limits`. We patch it to fall
// back to the canvas's own size (or a safe default) until the device limits arrive.
//
// `patched` makes this idempotent so importing/calling it from multiple UmapCanvas
// mounts (e.g. across re-renders or multiple collections open in tabs) only patches
// the shared CanvasContext prototype once.
let patched = false;

export function ensureCanvasContextLimits() {
  if (patched) {
    return;
  }
  patched = true;
  const original = CanvasContext.prototype.getMaxDrawingBufferSize;
  CanvasContext.prototype.getMaxDrawingBufferSize = function getMaxDrawingBufferSizePatched() {
    const maxTextureDimension = this.device?.limits?.maxTextureDimension2D;
    if (Number.isFinite(maxTextureDimension) && maxTextureDimension > 0) {
      return original.call(this);
    }
    const fallback = Math.max(
      this.canvas?.width ?? 1,
      this.canvas?.height ?? 1,
      DEFAULT_LIMIT_FALLBACK,
    );
    return [fallback, fallback];
  };
}
