"use client";

import { AudioLines, Brain, Image, Mic, Video, Wrench } from "lucide-react";

import { Tooltip } from "@/components/ui/tooltip";
import { capabilityDescriptor } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";

import type { ModelCapabilityId } from "@/lib/model-capabilities";
import type { LucideIcon } from "lucide-react";

const CAPABILITY_ICONS: Record<ModelCapabilityId, LucideIcon> = {
  tools: Wrench,
  reasoning: Brain,
  image_in: Image,
  audio_in: Mic,
  video_in: Video,
  image_out: Image,
  audio_out: AudioLines,
};

/**
 * One capability mark on a model row.
 *
 * Input capabilities read cyan (the "live/active" token) and outputs violet,
 * so a glance separates what a model takes from what it produces without a
 * second row of text. The glyph is `aria-hidden` and the meaning is carried by
 * the tooltip's accessible name — an icon whose meaning a user has to guess is
 * decoration, not information.
 */
export function CapabilityIcon({
  capability,
  className,
  decorative = false,
}: {
  capability: ModelCapabilityId;
  className?: string;
  /**
   * The caller already renders the capability's name beside the glyph. The
   * icon then carries no information of its own, so it drops both its tooltip
   * and its screen-reader label — keeping them would read the name twice.
   */
  decorative?: boolean;
}) {
  const descriptor = capabilityDescriptor(capability);
  const Icon = CAPABILITY_ICONS[capability];
  const shellClass = cn(
    "inline-flex h-4 w-4 items-center justify-center rounded-chip",
    descriptor.direction === "input"
      ? "bg-accent-cyan/10 text-accent-cyan"
      : "bg-accent-violet/12 text-accent-violet",
    className,
  );

  if (decorative) {
    return (
      <span aria-hidden className={shellClass}>
        <Icon className="h-2.5 w-2.5" />
      </span>
    );
  }

  return (
    <Tooltip content={descriptor.label} triggerElement="span" triggerClassName={shellClass}>
      <Icon className="h-2.5 w-2.5" aria-hidden />
      <span className="sr-only">{descriptor.label}</span>
    </Tooltip>
  );
}

/** The capability marks for one model, in catalog order. */
export function CapabilityIcons({
  capabilities,
  className,
}: {
  capabilities: ModelCapabilityId[];
  className?: string;
}) {
  if (capabilities.length === 0) {
    return null;
  }
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      {capabilities.map((capability) => (
        <CapabilityIcon key={capability} capability={capability} />
      ))}
    </span>
  );
}
