"use client";

import { ImagePlus, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { IMAGE_FILE_ACCEPT } from "@/lib/image-files";

import type { QueryImageState } from "@/components/collections/detail/search/use-query-image";

/**
 * The query's image: a picker, and the thumbnail of what is attached.
 *
 * Attaching replaces whatever is there — a query carries one image — and the
 * control reports the pipeline's refusal rather than sending an image no node
 * can read.
 */
export function QueryImageAttach({
  image,
  disabledReason,
  running,
}: {
  image: QueryImageState;
  /** Why the pipeline cannot take an image; null means it can. */
  disabledReason: string | null;
  running: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draft = image.image;

  return (
    <span className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void image.attach(file);
          event.target.value = "";
        }}
      />
      <Tooltip content={disabledReason ?? "Attach an image"} side="top">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Attach an image"
          disabled={running || Boolean(disabledReason)}
          onClick={() => fileInputRef.current?.click()}
          className="px-1.5 py-1.5"
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
        </Button>
      </Tooltip>
      {draft ? (
        <span className="relative inline-flex">
          {/* Object URLs are local previews next/image cannot accept. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.previewUrl}
            alt={draft.name}
            className="h-9 w-9 rounded-control border border-hairline object-cover"
          />
          <button
            type="button"
            aria-label={`Remove ${draft.name}`}
            onClick={image.clear}
            className="absolute -right-1.5 -top-1.5 rounded-full border border-hairline bg-surface-strong p-0.5 text-muted transition-colors duration-80 ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ) : null}
    </span>
  );
}
