import { formatDistanceToNow } from "date-fns";
import { extendTailwindMerge } from "tailwind-merge";

import { parseApiDate } from "@/lib/datetime";

/**
 * The repo's custom `@theme` scales, declared to tailwind-merge.
 *
 * tailwind-merge only knows Tailwind's stock scales. An undeclared custom
 * token falls through to whatever catch-all group matches its prefix, so
 * `text-instrument` is read as a text COLOUR and `cn("text-instrument
 * text-muted")` silently deletes the size — the element then renders at the
 * inherited scale instead of 11px. Every custom scale sharing a prefix with a
 * stock group must be listed here; the values mirror `src/app/globals.css`.
 *
 * `duration-*` is deliberately absent: those are bare Tailwind numerics
 * (`duration-80`), which the stock `duration` group already resolves.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // --text-* font sizes vs the --color-* text colours (text-muted, …).
      text: ["instrument", "ui", "num", "head"],
      // --radius-* vs Tailwind's rounded-sm/md/lg/full.
      radius: ["chip", "control", "panel"],
      // --shadow-* box shadows vs the shadow-<colour> utilities.
      shadow: ["elevation-1", "elevation-2", "glow"],
      // --ease-* vs Tailwind's ease-linear/in/out/in-out.
      ease: ["standard", "decel", "accel"],
    },
  },
});

export function cn(...classes: Array<string | false | null | undefined>) {
  return twMerge(classes.filter(Boolean).join(" "));
}

export function timeAgo(dateLike?: string | Date | null) {
  if (!dateLike) {
    return "—";
  }
  return formatDistanceToNow(parseApiDate(dateLike), { addSuffix: true });
}

export function truncate(text: string, limit = 200) {
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function prettyJson(payload: unknown, fallback = "—") {
  if (payload == null) return fallback;
  try {
    const value = typeof payload === "string" ? JSON.parse(payload) : payload;
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

export function isReasoningModel(model?: string | null) {
  if (!model) return false;
  const normalized = model.toLowerCase();
  return (
    normalized.includes("reason") || normalized.includes("o4") || normalized.includes("gpt-oss")
  );
}
