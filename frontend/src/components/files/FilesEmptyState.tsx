"use client";

import { Button } from "@/components/ui/button";

/**
 * What an empty folder shows: one line, one action.
 *
 * The whole region is a drop target and says so only while a drag is actually
 * in progress, so this carries neither a dashed placeholder box for a state
 * that is not happening nor a sentence describing the drop it already answers.
 * The glow stays on the toolbar's Upload — one glowing action per view.
 */
export function FilesEmptyState({ onPickFiles }: { onPickFiles: () => void }) {
  return (
    <div className="p-8 text-center">
      <p className="text-ui text-muted">This folder is empty.</p>
      <Button size="sm" className="mt-3" onClick={onPickFiles}>
        Upload files
      </Button>
    </div>
  );
}
