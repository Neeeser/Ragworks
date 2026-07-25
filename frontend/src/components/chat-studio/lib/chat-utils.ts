import { cn } from "@/lib/utils";

import type { ReasoningTraceSegment } from "@/lib/types";
import type { Components } from "react-markdown";

export const safeParseJSON = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const sanitizeModelSlug = (candidate?: string | null): string | null => {
  if (!candidate) {
    return null;
  }
  const baseSlug = candidate.split(":")[0].trim();
  if (!baseSlug || !baseSlug.includes("/")) {
    return null;
  }
  return baseSlug;
};

export const sanitizeFileName = (candidate?: string | null): string => {
  if (!candidate) {
    return "";
  }
  return candidate
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export const parsePriceInput = (value: string): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

export const coerceRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  if (value === null || value === undefined) {
    return {};
  }
  return { value };
};

const appendReasoningSegment = (
  target: ReasoningTraceSegment[],
  segment: ReasoningTraceSegment | null | undefined,
) => {
  if (!segment) {
    return;
  }
  const entry: ReasoningTraceSegment = { ...segment };
  const textValue =
    typeof entry.text === "string"
      ? entry.text
      : typeof entry.content === "string"
        ? entry.content
        : undefined;
  const mergeableTypes = new Set(["", "text", "reasoning.text"]);
  /* c8 ignore start -- merge heuristics are exercised in higher-level reasoning tests */
  if (textValue && target.length > 0 && mergeableTypes.has((entry.type ?? "").toLowerCase())) {
    const prev = target[target.length - 1];
    const prevMergeable = mergeableTypes.has((prev.type ?? "").toLowerCase());
    const contextKeys = ["id", "call_id", "tool_call_id"] as const;
    const sameContext = contextKeys.every((key) => {
      const prevValue = (prev as Record<string, unknown>)[key];
      const nextValue = (entry as Record<string, unknown>)[key];
      if (prevValue == null && nextValue == null) {
        return true;
      }
      return prevValue === nextValue;
    });
    if (prevMergeable && sameContext) {
      const existing =
        (typeof prev.text === "string"
          ? prev.text
          : /* c8 ignore next -- prev.text is normalized when textValue is available */
            typeof prev.content === "string"
            ? prev.content
            : "") ?? "";
      const combined = `${existing}${textValue}`;
      prev.text = combined;
      prev.content = combined;
      return;
    }
  }
  /* c8 ignore stop */
  if (textValue) {
    entry.text = textValue;
    entry.content = textValue;
    if (!entry.type) {
      entry.type = "text";
    }
  }
  target.push(entry);
};

const mergeReasoningSegments = (
  segments: Array<ReasoningTraceSegment | null | undefined>,
): ReasoningTraceSegment[] => {
  const merged: ReasoningTraceSegment[] = [];
  segments.forEach((segment) => {
    appendReasoningSegment(merged, segment);
  });
  return merged;
};

export const normalizeReasoningSegments = (payload: unknown): ReasoningTraceSegment[] => {
  if (!payload) {
    return [];
  }
  let segments: Array<ReasoningTraceSegment | null | undefined> = [];
  if (Array.isArray(payload)) {
    segments = payload as Array<ReasoningTraceSegment | null | undefined>;
  } else if (typeof payload === "object") {
    const candidate = payload as { segments?: Array<ReasoningTraceSegment | null | undefined> };
    if (Array.isArray(candidate?.segments)) {
      segments = candidate.segments;
    } else {
      segments = [candidate as ReasoningTraceSegment];
    }
  } else if (typeof payload === "string") {
    if (!payload.trim()) {
      segments = [];
    } else {
      segments = [{ type: "text", content: payload }];
    }
  } else {
    segments = [{ type: "value", content: String(payload) }];
  }
  return mergeReasoningSegments(segments);
};

export const markdownComponents: Components = {
  p: ({ children }) => (
    <div className="break-words text-sm leading-relaxed text-body">{children}</div>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent-cyan underline decoration-dotted underline-offset-4"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => (
    <code
      className={cn(
        "rounded bg-surface-strong px-1 py-0.5 text-[0.85em] text-accent-cyan",
        className,
      )}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mt-3 overflow-auto rounded-2xl bg-canvas-raised p-3 text-xs text-body">
      {children}
    </pre>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm">{children}</ol>,
  li: ({ children }) => <li className="text-body">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent-violet/60 pl-3 text-sm italic text-body">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
};
