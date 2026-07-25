"use client";

import { Button } from "@/components/ui/button";

/**
 * What an empty folder shows: one line, one action.
 *
 * The drop target is the whole region and says so only while a drag is actually
 * in progress, so this does not carry a dashed placeholder box for a state that
 * is not happening.
 */
export function FilesEmptyState({ onPickFiles }: { onPickFiles: () => void }) {
  return (
    <div className="p-8 text-center">
      <p className="text-ui text-muted">Nothing in this folder. Drop files here, or upload them.</p>
      <Button size="sm" className="mt-3" onClick={onPickFiles}>
        Upload files
      </Button>
    </div>
  );
}
