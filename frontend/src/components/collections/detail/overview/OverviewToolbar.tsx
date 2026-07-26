"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type OverviewToolbarProps = {
  collectionId: string;
  zoomed: boolean;
  onResetZoom: () => void;
};

/**
 * The charts' domain control and the collection's id.
 *
 * The drag hint earns its place: brushing is the only way to change the domain
 * and a draggable chart looks identical to a static one, so without a line of
 * text the control is undiscoverable.
 */
export function OverviewToolbar({ collectionId, zoomed, onResetZoom }: OverviewToolbarProps) {
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    await navigator.clipboard.writeText(collectionId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      {zoomed ? (
        <Button size="sm" variant="ghost" onClick={onResetZoom}>
          Reset zoom
        </Button>
      ) : (
        <span className="text-instrument text-meta">Drag across a chart to zoom into a range.</span>
      )}
      <Button size="sm" variant="ghost" onClick={copyId}>
        {copied ? (
          <Check className="h-3.5 w-3.5 text-data-pos" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
        {copied ? "Copied" : "Copy id"}
      </Button>
    </div>
  );
}
