'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import type { ReasoningTraceSegment } from '@/lib/types';

interface CollapsibleReasoningProps {
  segments: ReasoningTraceSegment[];
  messageId: string;
}

export function CollapsibleReasoning({ segments, messageId }: CollapsibleReasoningProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!segments || segments.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 overflow-hidden w-full">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-amber-500/15"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-300" />
          <span className="text-xs uppercase tracking-[0.3em] text-amber-200/80">
            Reasoning Tokens
          </span>
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-100">
            {segments.length} {segments.length === 1 ? 'step' : 'steps'}
          </span>
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-amber-300" />
        ) : (
          <ChevronRight className="h-4 w-4 text-amber-300" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-amber-400/30 px-4 py-3 space-y-3">
          {segments.map((segment, idx) => {
            const reasoningText =
              (typeof segment.text === 'string' && segment.text.trim()) ||
              (typeof segment.content === 'string' && segment.content.trim()) ||
              JSON.stringify(segment, null, 2);

            return (
              <div
                key={`${messageId}-reasoning-${idx}`}
                className="rounded-xl border border-amber-400/20 bg-amber-900/20 px-3 py-2"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-amber-200">
                    Step {idx + 1}
                  </span>
                  {segment.type && (
                    <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-100">
                      {segment.type}
                    </span>
                  )}
                </div>
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-amber-50">
                  {reasoningText}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
