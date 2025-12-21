import type { Components } from 'react-markdown';

import type { ReasoningTraceSegment } from '@/lib/types';
import { cn } from '@/lib/utils';

const joinTextWithSpacing = (left: string, right: string): string => {
  if (!left) return right;
  if (!right) return left;
  return `${left}${right}`;
};

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
  const baseSlug = candidate.split(':')[0]?.trim() ?? '';
  if (!baseSlug || !baseSlug.includes('/')) {
    return null;
  }
  return baseSlug;
};

export const sanitizeFileName = (candidate?: string | null): string => {
  if (!candidate) {
    return '';
  }
  return candidate
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  if (value && typeof value === 'object' && !Array.isArray(value)) {
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
  segment: ReasoningTraceSegment,
) => {
  if (!segment) {
    return;
  }
  const entry: ReasoningTraceSegment = { ...segment };
  const textValue =
    typeof entry.text === 'string'
      ? entry.text
      : typeof entry.content === 'string'
        ? entry.content
        : undefined;
  const mergeableTypes = new Set(['', 'text', 'reasoning.text']);
  if (
    textValue &&
    target.length > 0 &&
    mergeableTypes.has((entry.type ?? '').toLowerCase())
  ) {
    const prev = target[target.length - 1];
    const prevMergeable = mergeableTypes.has((prev.type ?? '').toLowerCase());
    const contextKeys = ['id', 'call_id', 'tool_call_id'] as const;
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
        (typeof prev.text === 'string' ? prev.text : typeof prev.content === 'string' ? prev.content : '') ?? '';
      const combined = joinTextWithSpacing(existing, textValue);
      prev.text = combined;
      prev.content = combined;
      return;
    }
  }
  if (textValue) {
    entry.text = textValue;
    entry.content = textValue;
    if (!entry.type) {
      entry.type = 'text';
    }
  }
  target.push(entry);
};

const mergeReasoningSegments = (segments: ReasoningTraceSegment[]): ReasoningTraceSegment[] => {
  const merged: ReasoningTraceSegment[] = [];
  segments.forEach((segment) => {
    if (segment) {
      appendReasoningSegment(merged, segment);
    }
  });
  return merged;
};

export const normalizeReasoningSegments = (payload: unknown): ReasoningTraceSegment[] => {
  if (!payload) {
    return [];
  }
  let segments: ReasoningTraceSegment[] = [];
  if (Array.isArray(payload)) {
    segments = payload.filter(Boolean) as ReasoningTraceSegment[];
  } else if (typeof payload === 'object') {
    const candidate = payload as { segments?: ReasoningTraceSegment[] };
    if (Array.isArray(candidate?.segments)) {
      segments = candidate.segments.filter(Boolean) as ReasoningTraceSegment[];
    } else {
      segments = [candidate as ReasoningTraceSegment];
    }
  } else if (typeof payload === 'string') {
    if (!payload.trim()) {
      segments = [];
    } else {
      segments = [{ type: 'text', content: payload }];
    }
  } else {
    segments = [{ type: 'value', content: String(payload) }];
  }
  return mergeReasoningSegments(segments);
};

export const markdownComponents: Components = {
  p: ({ children }) => (
    <div className="break-words text-sm leading-relaxed text-slate-100">{children}</div>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-cyan-300 underline decoration-dotted underline-offset-4"
    >
      {children}
    </a>
  ),
  code: ({ inline, className, children }) => {
    const isInline = inline !== false;
    return isInline ? (
      <code className={cn('rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-cyan-200', className)}>
        {children}
      </code>
    ) : (
      <code className={cn('text-xs text-slate-100', className)}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="mt-3 overflow-auto rounded-2xl bg-slate-900/70 p-3 text-xs text-slate-100">
      {children}
    </pre>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm">{children}</ol>,
  li: ({ children }) => <li className="text-slate-100">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-violet-400/60 pl-3 text-sm italic text-slate-200">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
};
