import { NextResponse } from "next/server";

import { LANDING_SCENES } from "@/components/landing/lib/scenes";

/**
 * The scene list the capture script records, served from the same registry the
 * landing hero rotates. The script cannot import the TypeScript registry, so
 * reading it over the wire is what keeps the two illustrations on one cycle
 * instead of two hand-synced lists.
 *
 * Capture-only, like the page it belongs to: the running app never serves it.
 */
export function GET() {
  if (process.env.README_CAPTURE !== "1") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({
    scenes: LANDING_SCENES.map((scene) => ({
      id: scene.id,
      kind: scene.kind,
      label: scene.label,
    })),
  });
}
