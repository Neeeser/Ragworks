import { formatDistanceToNow } from "date-fns";
import { twMerge } from "tailwind-merge";

import { parseApiDate } from "@/lib/datetime";

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
