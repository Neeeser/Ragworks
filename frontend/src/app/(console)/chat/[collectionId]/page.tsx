'use client';

import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  MessageCircle,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PlusCircle,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { Components } from 'react-markdown';

import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/panel';
import { Loader } from '@/components/ui/loader';
import { CollapsibleReasoning } from '@/components/ui/collapsible-reasoning';
import { TypingAnimation } from '@/components/ui/typing-animation';
import {
  chatWithCollection,
  deleteChatSession,
  fetchCollections,
  fetchDocuments,
  getChatHistory,
  getCollectionPrompt,
  listChatSessions,
  listModelEndpoints,
  listModels,
  streamChatWithCollection,
  updateCollectionPrompt,
} from '@/lib/api';
import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  Collection,
  CollectionPromptDetails,
  ModelEndpointDirectory,
  ModelInfo,
  ProviderEndpoint,
  ProviderPreferences,
  ProviderSortOption,
  ReasoningTraceSegment,
  ToolCallTrace,
  UsageBreakdown,
} from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

const samplePrompts = [
  'Give me the latest ingestion summary with citations.',
  'What changed in the newest document batch?',
  'Draft next steps using the last three answers.',
  'List any flagged chunks that might need review.',
];

type ParameterInputKind = 'number' | 'integer' | 'boolean' | 'list' | 'json' | 'select';

interface ParameterOption {
  label: string;
  value: string;
}

interface ParameterDefinitionShape {
  key: string;
  label: string;
  description: string;
  input: ParameterInputKind;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  options?: ParameterOption[];
  rows?: number;
}

const PARAMETER_DEFINITIONS = [
  {
    key: 'temperature',
    label: 'Temperature',
    description: 'Higher values increase randomness (0-2).',
    input: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    placeholder: '1.0',
  },
  {
    key: 'top_p',
    label: 'Top P',
    description: 'Limit tokens to a probability mass.',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    placeholder: '1.0',
  },
  {
    key: 'top_k',
    label: 'Top K',
    description: 'Sample only from the top K tokens.',
    input: 'integer',
    min: 0,
    step: 1,
    placeholder: '0 (disabled)',
  },
  {
    key: 'min_p',
    label: 'Min P',
    description: 'Minimum relative probability threshold.',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: '0.0',
  },
  {
    key: 'top_a',
    label: 'Top A',
    description: 'Adaptive nucleus setting (0-1).',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: '0.0',
  },
  {
    key: 'frequency_penalty',
    label: 'Frequency penalty',
    description: 'Penalize repeated tokens by count.',
    input: 'number',
    min: -2,
    max: 2,
    step: 0.1,
    placeholder: '0.0',
  },
  {
    key: 'presence_penalty',
    label: 'Presence penalty',
    description: 'Discourage reusing prior tokens.',
    input: 'number',
    min: -2,
    max: 2,
    step: 0.1,
    placeholder: '0.0',
  },
  {
    key: 'repetition_penalty',
    label: 'Repetition penalty',
    description: 'Reduce repeated generations.',
    input: 'number',
    min: 0,
    max: 2,
    step: 0.05,
    placeholder: '1.0',
  },
  {
    key: 'max_tokens',
    label: 'Max tokens',
    description: 'Cap on generated tokens.',
    input: 'integer',
    min: 1,
    step: 1,
    placeholder: '512',
  },
  {
    key: 'reasoning',
    label: 'Reasoning effort',
    description: 'Control how much thinking budget the model should spend when reasoning tokens are available.',
    input: 'select',
    options: [
      { label: 'Model default', value: '' },
      { label: 'Minimal', value: 'minimal' },
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
  },
  {
    key: 'seed',
    label: 'Seed',
    description: 'Deterministic sampling seed.',
    input: 'integer',
    min: 0,
    step: 1,
    placeholder: 'Leave blank for randomness',
  },
  {
    key: 'logprobs',
    label: 'Log probabilities',
    description: 'Return logprobs for each token.',
    input: 'boolean',
  },
  {
    key: 'top_logprobs',
    label: 'Top logprobs',
    description: 'How many alternate tokens to include (0-20).',
    input: 'integer',
    min: 0,
    max: 20,
    step: 1,
    placeholder: '5',
  },
  {
    key: 'structured_outputs',
    label: 'Structured outputs',
    description: 'Request JSON schema enforcement.',
    input: 'boolean',
  },
  {
    key: 'verbosity',
    label: 'Verbosity',
    description: 'Control response detail level.',
    input: 'select',
    options: [
      { label: 'Model default', value: '' },
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
  },
  {
    key: 'stop',
    label: 'Stop sequences',
    description: 'Comma or newline separated stop strings.',
    input: 'list',
    placeholder: '###, END',
    rows: 2,
  },
  {
    key: 'response_format',
    label: 'Response format',
    description: 'JSON describing the expected response schema.',
    input: 'json',
    placeholder: '{ "type": "json_object" }',
    rows: 3,
  },
  {
    key: 'logit_bias',
    label: 'Logit bias',
    description: 'JSON map of token IDs to bias values.',
    input: 'json',
    placeholder: '{ "318": -100 }',
    rows: 3,
  },
] as const satisfies readonly ParameterDefinitionShape[];

type ParameterDefinition = (typeof PARAMETER_DEFINITIONS)[number];
type ModelParameterKey = ParameterDefinition['key'];
type ParameterValue = number | string | boolean | Record<string, unknown>;
type ParameterOverrides = Partial<Record<ModelParameterKey, ParameterValue>>;

type ProviderSortChoice = '' | ProviderSortOption;

interface ProviderFormState {
  sort: ProviderSortChoice;
  order: string[];
  only: string[];
  ignore: string[];
  quantizations: string[];
  allowFallbacks: boolean;
  requireParameters: boolean;
  dataCollection: 'allow' | 'deny';
  zdr: boolean;
  enforceDistillableText: boolean;
  maxPrompt: string;
  maxCompletion: string;
  maxRequest: string;
  maxImage: string;
}

type ProviderSelectionField = 'order' | 'only' | 'ignore';

const PARAMETER_DEFINITION_MAP: Record<ModelParameterKey, ParameterDefinition> =
  PARAMETER_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.key] = definition;
      return acc;
    },
    {} as Record<ModelParameterKey, ParameterDefinition>,
  );

const safeParseJSON = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const usePersistentToggle = (key: string, defaultValue: boolean) => {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') {
      return defaultValue;
    }
    const stored = window.localStorage.getItem(key);
    return stored === null ? defaultValue : stored === 'true';
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(key, value ? 'true' : 'false');
  }, [key, value]);

  return [value, setValue] as const;
};

const joinTextWithSpacing = (left: string, right: string): string => {
  if (!left) return right;
  if (!right) return left;
  return `${left}${right}`;
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

const normalizeReasoningSegments = (payload: unknown): ReasoningTraceSegment[] => {
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

const coerceRecord = (value: unknown): Record<string, unknown> => {
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

const formatKeyLabel = (key: string): string => {
  return key
    .split(/[\s._-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const truncateText = (value: string, limit = 360): string => {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}…`;
};

const formatToolLabel = (label: string): string => {
  if (!label) return 'Tool';
  const friendly = label
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
  return friendly || 'Tool';
};

const stringifyData = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

interface JsonBlockProps {
  data: unknown;
  className?: string;
  maxHeight?: number;
}

const JsonBlock = ({ data, className, maxHeight = 240 }: JsonBlockProps) => (
  <pre
    style={{ maxHeight }}
    className={cn(
      'overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950/40 p-3 text-xs text-slate-100',
      className,
    )}
  >
    {stringifyData(data)}
  </pre>
);

interface ToolValueProps {
  value: unknown;
}

const ToolValue = ({ value }: ToolValueProps) => {
  if (value === null || value === undefined) {
    return <span className="text-slate-400">N/A</span>;
  }
  if (typeof value === 'string') {
    return <span className="font-medium text-white">{value}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <code className="rounded bg-white/10 px-1 py-0.5 text-xs text-cyan-200">
        {String(value)}
      </code>
    );
  }
  if (Array.isArray(value)) {
    const primitiveItems = value.every(
      (item) =>
        item === null ||
        item === undefined ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    );
    if (primitiveItems) {
      return (
        <ul className="list-disc space-y-1 pl-5 text-slate-100">
          {value.map((item, index) => (
            <li key={`tool-value-${index}`}>{String(item ?? 'N/A')}</li>
          ))}
        </ul>
      );
    }
    return <JsonBlock data={value} />;
  }
  if (typeof value === 'object') {
    return <JsonBlock data={value} />;
  }
  return <span className="text-white">{String(value)}</span>;
};

interface ToolKeyValueGridProps {
  data: Record<string, unknown>;
  emptyLabel?: string;
}

const ToolKeyValueGrid = ({ data, emptyLabel = 'No data available.' }: ToolKeyValueGridProps) => {
  const entries = Object.entries(data).filter((entry) => {
    const value = entry[1];
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return true;
  });

  if (entries.length === 0) {
    return <p className="text-xs text-slate-400">{emptyLabel}</p>;
  }

  return (
    <dl className="grid gap-3 text-left sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="rounded-2xl border border-white/10 bg-slate-950/30 p-3"
        >
          <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
            {formatKeyLabel(key)}
          </dt>
          <dd className="mt-1 text-sm">
            <ToolValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

interface ToolPayloadSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

const ToolPayloadSection = ({
  title,
  description,
  children,
  collapsible = false,
  defaultOpen = true,
}: ToolPayloadSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
        <header>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-300">{title}</p>
          {description && <p className="text-xs text-slate-400">{description}</p>}
        </header>
        {children}
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-300">{title}</p>
          {description && <p className="text-xs text-slate-400">{description}</p>}
        </div>
        <ChevronDown className={cn('h-4 w-4 text-slate-200 transition', open ? 'rotate-180' : '')} />
      </button>
      {open && <div>{children}</div>}
    </section>
  );
};

interface ToolChunkListProps {
  chunks: unknown[];
}

const ToolChunkList = ({ chunks }: ToolChunkListProps) => {
  const normalized = chunks
    .map((chunk) => (chunk && typeof chunk === 'object' ? (chunk as Record<string, unknown>) : null))
    .filter(Boolean) as Record<string, unknown>[];

  if (normalized.length === 0) {
    return <p className="text-xs text-slate-400">No chunk data returned.</p>;
  }

  return (
    <div className="space-y-3">
      {normalized.map((chunk, index) => {
        const chunkId = (chunk.chunk_id as string) || (chunk.id as string) || `chunk-${index + 1}`;
        const documentId = (chunk.document_id as string) ?? chunk.documentId;
        const order = typeof chunk.order === 'number' ? chunk.order : null;
        const score =
          typeof chunk.score === 'number'
            ? chunk.score
            : typeof chunk.score === 'string'
              ? Number(chunk.score)
              : null;
        const textValue = typeof chunk.text === 'string' ? chunk.text : null;
        const metadata =
          chunk.metadata && typeof chunk.metadata === 'object'
            ? (chunk.metadata as Record<string, unknown>)
            : null;

        return (
          <article
            key={`${chunkId}-${index}`}
            className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
          >
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400">
              <span>Chunk {index + 1}</span>
              {Number.isFinite(score) && (
                <span className="font-mono text-cyan-200">
                  Score {Number(score).toFixed(3)}
                </span>
              )}
            </div>
            {textValue && (
              <p className="mt-2 text-sm text-slate-100">{truncateText(textValue)}</p>
            )}
            <dl className="mt-3 grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
              {documentId && (
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Document</dt>
                  <dd className="font-mono text-slate-100">{documentId}</dd>
                </div>
              )}
              {chunkId && (
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Chunk ID</dt>
                  <dd className="font-mono text-slate-100 break-all">{chunkId}</dd>
                </div>
              )}
              {Number.isFinite(order) && (
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Order</dt>
                  <dd className="font-mono text-slate-100">{order}</dd>
                </div>
              )}
            </dl>
            {metadata && Object.keys(metadata).length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Metadata</p>
                <JsonBlock data={metadata} maxHeight={180} className="mt-1" />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};

interface ToolCallBubbleProps {
  label: string;
  variantClass: string;
  args: Record<string, unknown>;
  response: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

const ToolCallBubble = ({ label, variantClass, args, response, rawPayload }: ToolCallBubbleProps) => {
  const responseMeta: Record<string, unknown> = { ...response };
  const rawChunks = responseMeta.chunks;
  if (Object.prototype.hasOwnProperty.call(responseMeta, 'chunks')) {
    delete responseMeta.chunks;
  }
  const chunkList = Array.isArray(rawChunks) ? rawChunks : null;
  const hasResponseMeta = Object.keys(responseMeta).length > 0;

  const chunkPreview = chunkList?.find(
    (chunk) => chunk && typeof chunk === 'object' && typeof (chunk as Record<string, unknown>).text === 'string',
  ) as Record<string, unknown> | undefined;
  const chunkPreviewText = chunkPreview?.text as string | undefined;
  const summary =
    (typeof args.query === 'string' && args.query.trim()) ||
    (typeof responseMeta.query === 'string' && responseMeta.query.trim()) ||
    (chunkPreviewText ? truncateText(chunkPreviewText, 120) : null) ||
    'View tool output';
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex justify-start">
      <div className={cn('max-w-[75%] rounded-2xl border px-4 py-3 text-sm', variantClass)}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200">Tool Call</p>
            <p className="text-base font-semibold text-white">{formatToolLabel(label)}</p>
          </div>
          <span className="rounded-full border border-cyan-300/40 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-cyan-200">
            Complete
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-3 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-left text-sm text-slate-200 transition hover:border-cyan-300/40"
          aria-expanded={expanded}
        >
          <div className="flex-1 pr-3">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Summary</p>
            <p className="line-clamp-2 text-sm text-white">{summary}</p>
          </div>
          <ChevronDown className={cn('h-4 w-4 text-cyan-200 transition', expanded ? 'rotate-180' : '')} />
        </button>
        {expanded && (
          <div className="mt-4 space-y-4">
            <ToolPayloadSection title="Invocation" description="Parameters sent with this call.">
              <ToolKeyValueGrid data={args} emptyLabel="No arguments were provided." />
            </ToolPayloadSection>
            {chunkList && chunkList.length > 0 ? (
              <>
                <ToolPayloadSection
                  title={`Retrieved chunks (${chunkList.length})`}
                  description="Top matches returned by the retriever."
                  collapsible
                  defaultOpen={false}
                >
                  <ToolChunkList chunks={chunkList} />
                </ToolPayloadSection>
                {hasResponseMeta && (
                  <ToolPayloadSection title="Response metadata" collapsible defaultOpen={false}>
                    <ToolKeyValueGrid data={responseMeta} emptyLabel="No metadata returned." />
                  </ToolPayloadSection>
                )}
              </>
            ) : (
              <ToolPayloadSection title="Response" collapsible defaultOpen={false}>
                <ToolKeyValueGrid data={responseMeta} emptyLabel="Tool did not return structured data." />
              </ToolPayloadSection>
            )}
            <details className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-100">
              <summary className="cursor-pointer text-sm font-semibold text-slate-100">
                Raw payload
              </summary>
              <JsonBlock data={rawPayload} className="mt-3" />
            </details>
          </div>
        )}
      </div>
    </div>
  );
};

const QUANTIZATION_OPTIONS = [
  'int4',
  'int8',
  'fp4',
  'fp6',
  'fp8',
  'fp16',
  'bf16',
  'fp32',
  'unknown',
] as const;

const ENDPOINT_STATUS_LABELS: Record<string, string> = {
  '0': 'Operational',
  '-1': 'Degraded',
  '-2': 'Unhealthy',
  '-3': 'Outage',
  '-5': 'Offline',
  '-10': 'Disabled',
};

const formatPricePerMillion = (value?: number | string | null): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const raw =
    typeof value === 'number'
      ? value
      : Number(
        String(value)
          .trim()
          .replace(/[^0-9eE.+-]/g, ''),
      );
  if (!Number.isFinite(raw)) {
    const fallback = String(value).trim();
    return fallback || null;
  }
  const pricePerMillion = raw * 1_000_000;
  const trimFractionDigits = (numericString: string, minFractionDigits: number) => {
    if (!numericString.includes('.')) {
      return numericString;
    }
    const [whole, fraction] = numericString.split('.');
    if (fraction.length <= minFractionDigits) {
      return `${whole}.${fraction.padEnd(minFractionDigits, '0')}`;
    }
    let trimmedFraction = fraction;
    while (trimmedFraction.length > minFractionDigits && trimmedFraction.endsWith('0')) {
      trimmedFraction = trimmedFraction.slice(0, -1);
    }
    return trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : whole;
  };

  let minFractionDigits = 0;
  let maxFractionDigits = 0;
  if (pricePerMillion >= 100) {
    minFractionDigits = 0;
    maxFractionDigits = 0;
  } else if (pricePerMillion >= 10) {
    minFractionDigits = 1;
    maxFractionDigits = 1;
  } else if (pricePerMillion >= 1) {
    minFractionDigits = 2;
    maxFractionDigits = 2;
  } else if (pricePerMillion >= 0.1) {
    minFractionDigits = 2;
    maxFractionDigits = 3;
  } else if (pricePerMillion >= 0.01) {
    minFractionDigits = 2;
    maxFractionDigits = 4;
  } else {
    minFractionDigits = 2;
    maxFractionDigits = 6;
  }
  const fixed = pricePerMillion.toFixed(maxFractionDigits);
  const normalized = trimFractionDigits(fixed, minFractionDigits);
  return `$${normalized}/M`;
};

const formatProviderPrice = (value?: number | string | null): string => {
  return formatPricePerMillion(value) ?? '—';
};

const formatUptimePercentage = (value?: number | null): string => {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
};

const getEndpointStatusLabel = (status?: string | number | null): string => {
  if (!status) {
    return 'Unknown';
  }
  const key = typeof status === 'number' ? String(status) : status;
  return ENDPOINT_STATUS_LABELS[key] ?? 'Unknown';
};

const sanitizeModelSlug = (candidate?: string | null): string | null => {
  if (!candidate) {
    return null;
  }
  const baseSlug = candidate.split(':')[0]?.trim() ?? '';
  if (!baseSlug || !baseSlug.includes('/')) {
    return null;
  }
  return baseSlug;
};

const sanitizeFileName = (candidate?: string | null): string => {
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

const parsePriceInput = (value: string): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

const createDefaultProviderForm = (): ProviderFormState => ({
  sort: '',
  order: [],
  only: [],
  ignore: [],
  quantizations: [],
  allowFallbacks: true,
  requireParameters: false,
  dataCollection: 'allow',
  zdr: false,
  enforceDistillableText: false,
  maxPrompt: '',
  maxCompletion: '',
  maxRequest: '',
  maxImage: '',
});

const deriveToolTracesFromMessages = (items: ChatMessage[]): ToolCallTrace[] =>
  items
    .filter((message) => message.role === 'tool')
    .map((message) => {
      const payload =
        (message.tool_payload as Record<string, unknown> | null) ?? safeParseJSON(message.content) ?? {};
      const payloadRecord = coerceRecord(payload);
      const argsValue = payloadRecord.arguments ?? {};
      const responseValue = payloadRecord.response ?? payloadRecord;
      const reasoningSegments = normalizeReasoningSegments(message.reasoning_trace);
      return {
        id: message.tool_call_id || message.id,
        name: message.tool_name || 'tool_call',
        arguments: coerceRecord(argsValue),
        response: coerceRecord(responseValue),
        reasoning: reasoningSegments.length > 0 ? { segments: reasoningSegments } : null,
      } satisfies ToolCallTrace;
    });

interface TelemetrySectionProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

const TelemetrySection = ({
  title,
  description,
  icon,
  isOpen,
  onToggle,
  children,
}: TelemetrySectionProps) => (
  <div className="rounded-2xl border border-white/10 bg-white/5">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/10"
    >
      <div className="flex flex-1 items-center gap-2">
        {icon && <span className="text-slate-300">{icon}</span>}
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{title}</p>
          {description && (
            <p className="text-[11px] text-slate-300">{description}</p>
          )}
        </div>
      </div>
      {isOpen ? (
        <ChevronDown className="h-4 w-4 text-slate-300" />
      ) : (
        <ChevronRight className="h-4 w-4 text-slate-300" />
      )}
    </button>
    {isOpen && <div className="space-y-3 px-4 pb-4 pt-3">{children}</div>}
  </div>
);

const usageMetrics: { key: keyof UsageBreakdown; label: string }[] = [
  { key: 'prompt_tokens', label: 'Prompt tokens' },
  { key: 'completion_tokens', label: 'Completion tokens' },
  { key: 'total_tokens', label: 'Total tokens' },
  { key: 'reasoning_tokens', label: 'Reasoning tokens' },
];

const calculateSessionUsage = (items: ChatMessage[]): UsageBreakdown | null => {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalReasoningTokens = 0;
  let totalCost = 0;
  let hasUsage = false;

  for (const message of items) {
    if (message.usage) {
      hasUsage = true;
      if (message.usage.prompt_tokens != null) {
        totalPromptTokens += message.usage.prompt_tokens;
      }
      if (message.usage.completion_tokens != null) {
        totalCompletionTokens += message.usage.completion_tokens;
      }
      if (message.usage.total_tokens != null) {
        totalTokens += message.usage.total_tokens;
      }
      if (message.usage.reasoning_tokens != null) {
        totalReasoningTokens += message.usage.reasoning_tokens;
      }
      if (message.usage.cost != null) {
        totalCost += message.usage.cost;
      }
    }
  }

  if (!hasUsage) {
    return null;
  }

  return {
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    total_tokens: totalTokens,
    reasoning_tokens: totalReasoningTokens,
    cost: totalCost,
  };
};

const attachUsageToLastAssistantMessage = (
  messages: ChatMessage[],
  usage: UsageBreakdown | null,
): ChatMessage[] => {
  if (!usage) {
    return messages;
  }
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!lastAssistant || lastAssistant.usage) {
    return messages;
  }
  return messages.map((message) =>
    message.id === lastAssistant.id ? { ...message, usage } : message,
  );
};

const isToolReasoningSegment = (segment: ReasoningTraceSegment): boolean => {
  const typeValue = typeof segment.type === 'string' ? segment.type.toLowerCase() : '';
  if (
    typeValue === 'tool_call' ||
    typeValue === 'tool_use' ||
    typeValue === 'tool_request' ||
    typeValue === 'call_tool' ||
    typeValue === 'function_call'
  ) {
    return true;
  }
  return Boolean(segment.call || segment.function || segment.tool_call_id || segment.tool_name);
};

const generateClientSessionId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    if (char === 'x') {
      return rand.toString(16);
    }
    // Ensure the variant bits are 10xx for UUID v4 compatibility
    return ((rand & 0x3) | 0x8).toString(16);
  });
};

const generateClientMessageId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `client-${crypto.randomUUID()}`;
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const CHAT_INPUT_MIN_HEIGHT = 40;
const CHAT_INPUT_MAX_HEIGHT = 160;
const STREAM_REVEAL_DELAY = 350;
const PROGRESS_POLL_INTERVAL = 800;

const markdownComponents: Components = {
  p: ({ children }) => (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{children}</div>
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
  code: ({ inline, className, children }) =>
    inline ? (
      <code className={cn('rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-cyan-200', className)}>
        {children}
      </code>
    ) : (
      <pre className="mt-3 overflow-auto rounded-2xl bg-slate-900/70 p-3 text-xs text-slate-100">
        <code className={className}>{children}</code>
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

const sortMessagesChronologically = (messages: ChatMessage[]) => {
  return [...messages].sort((a, b) => {
    const aTime = Date.parse(a.created_at) || 0;
    const bTime = Date.parse(b.created_at) || 0;
    if (aTime === bTime) {
      return a.id.localeCompare(b.id);
    }
    return aTime - bTime;
  });
};

const mergeMessageHistory = (
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] => {
  if (incoming.length === 0) {
    return existing;
  }
  const mergedMap = new Map<string, ChatMessage>();
  existing.forEach((message) => mergedMap.set(message.id, message));
  incoming.forEach((message) => mergedMap.set(message.id, message));
  return sortMessagesChronologically(Array.from(mergedMap.values()));
};

export default function ChatStudioExperience() {
  const params = useParams<{ collectionId: string }>();
  const collectionId = params?.collectionId ?? '';
  const router = useRouter();
  const { token } = useAuth();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [documentCount, setDocumentCount] = useState(0);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolCallTrace[]>([]);
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[]>([]);
  const [pendingMessageIds, setPendingMessageIds] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [contextWindow, setContextWindow] = useState<number>(0);
  const [contextConsumed, setContextConsumed] = useState<number>(0);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = usePersistentToggle('chat.historyOpen', true);
  const [telemetryOpen, setTelemetryOpen] = usePersistentToggle('chat.telemetryOpen', true);
  const [modelSelectorOpen, setModelSelectorOpen] = usePersistentToggle(
    'chat.telemetry.modelsOpen',
    true,
  );
  const [systemPromptOpen, setSystemPromptOpen] = usePersistentToggle('chat.telemetry.promptOpen', true);
  const [vitalsOpen, setVitalsOpen] = usePersistentToggle('chat.telemetry.vitalsOpen', true);
  const [usageOpen, setUsageOpen] = usePersistentToggle('chat.telemetry.usageOpen', true);
  const [modelParametersOpen, setModelParametersOpen] = usePersistentToggle(
    'chat.telemetry.parametersOpen',
    true,
  );
  const [providerPreferencesOpen, setProviderPreferencesOpen] = usePersistentToggle(
    'chat.telemetry.providersOpen',
    true,
  );
  const [streamingOptionsOpen, setStreamingOptionsOpen] = usePersistentToggle(
    'chat.telemetry.streamingOpen',
    true,
  );
  const [streamingEnabled, setStreamingEnabled] = usePersistentToggle('chat.streamingEnabled', false);
  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [modelSearchTerm, setModelSearchTerm] = useState('');
  const [parameterOverrides, setParameterOverrides] = useState<ParameterOverrides>({});
  const [providerForm, setProviderForm] = useState<ProviderFormState>(() => createDefaultProviderForm());
  const [providerDirectory, setProviderDirectory] = useState<ModelEndpointDirectory | null>(null);
  const [providerDirectoryLoading, setProviderDirectoryLoading] = useState(false);
  const [providerDirectoryError, setProviderDirectoryError] = useState<string | null>(null);
  const [providerSearchTerm, setProviderSearchTerm] = useState('');
  const [promptDetails, setPromptDetails] = useState<CollectionPromptDetails | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [liveResponse, setLiveResponse] = useState('');
  const [isStreamingResponse, setIsStreamingResponse] = useState(false);
  const [liveReasoningSegments, setLiveReasoningSegments] = useState<ReasoningTraceSegment[]>([]);
  const [persistedLiveReasoningSegments, setPersistedLiveReasoningSegments] = useState<
    ReasoningTraceSegment[]
  >([]);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [liveResponseAnimationKey, setLiveResponseAnimationKey] = useState(0);
  const [liveReasoningAnimationKey, setLiveReasoningAnimationKey] = useState(0);
  const [activeReasoningId, setActiveReasoningId] = useState<string | null>(null);
  const [manuallyOpenedReasoningIds, setManuallyOpenedReasoningIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [reasoningFocusActive, setReasoningFocusActive] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const reasoningFocusTimeoutRef = useRef<number | null>(null);
  const chatPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const promptEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const activePollingSession = useRef<string | null>(null);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());
  const reasoningCacheRef = useRef<Map<string, ReasoningTraceSegment[]>>(new Map());

  const hasLiveText = liveResponse.trim().length > 0;
  const hasLiveReasoning = liveReasoningSegments.length > 0;
  const showStreamingBubble =
    streamingEnabled && (isStreamingResponse || hasLiveText || hasLiveReasoning);
  const liveReasoningDisplaySegments = hasLiveReasoning
    ? liveReasoningSegments
    : persistedLiveReasoningSegments;
  const hasDisplayedLiveReasoning = liveReasoningDisplaySegments.length > 0;
  const shouldShowStreamingReasoningBubble =
    (showStreamingBubble || hasDisplayedLiveReasoning) && hasDisplayedLiveReasoning;

  useEffect(() => {
    if (!hasLiveText) {
      return;
    }
    setLiveResponseAnimationKey((prev) => prev + 1);
  }, [hasLiveText, liveResponse]);

  useEffect(() => {
    if (liveReasoningSegments.length === 0) {
      return;
    }
    setLiveReasoningAnimationKey((prev) => prev + 1);
  }, [liveReasoningSegments]);

  const resetLiveReasoningState = useCallback(() => {
    setLiveReasoningSegments([]);
    setPersistedLiveReasoningSegments([]);
  }, []);

  const syncMessages = useCallback(
    (incoming: ChatMessage[], options: { hydrate?: boolean } = {}) => {
      const { hydrate = false } = options;
      setMessages((previousMessages) => {
        const sortedIncoming = sortMessagesChronologically(incoming);
        const nextMessages = hydrate
          ? sortedIncoming
          : mergeMessageHistory(previousMessages, sortedIncoming);

        setVisibleMessageIds((prevVisible) => {
          const nextIds = nextMessages.map((message) => message.id);
          if (hydrate || prevVisible.length === 0) {
            setPendingMessageIds([]);
            return nextIds;
          }
          const nextIdSet = new Set(nextIds);
          const hasRemoval = prevVisible.some((id) => !nextIdSet.has(id));
          if (hasRemoval) {
            setPendingMessageIds([]);
            return nextIds;
          }
          const prevSet = new Set(prevVisible);
          const newIds = nextIds.filter((id) => !prevSet.has(id));
          if (newIds.length > 0) {
            setPendingMessageIds((queue) => [...queue, ...newIds]);
          }
          return prevVisible;
        });

        return nextMessages;
      });
    },
    [],
  );

  const deriveToolTraces = useCallback((items: ChatMessage[]) => deriveToolTracesFromMessages(items), []);

  const authToken = token ?? '';
  const headerDescription =
    collection ? collection.description?.trim() || 'No description provided yet.' : '';

  const sortSessions = useCallback((items: ChatSession[]) => {
    const pendingIds = pendingSessionIdsRef.current;
    return [...items].sort((a, b) => {
      const aPending = pendingIds.has(a.id);
      const bPending = pendingIds.has(b.id);
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, []);

  useEffect(() => {
    if (!authToken || !collectionId) {
      setLoading(false);
      setStatus(collectionId ? 'Sign in to access this collection.' : 'Missing collection id.');
      return;
    }
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setStatus(null);
      try {
        const allCollections = await fetchCollections(authToken);
        if (cancelled) return;
        const active = allCollections.find((col) => col.id === collectionId);
        if (!active) {
          setStatus('Collection not found.');
          setCollection(null);
          return;
        }
        setCollection(active);
        setContextWindow(active.context_window);
        const [documents, sessionList] = await Promise.all([
          fetchDocuments(active.id, authToken).catch(() => []),
          listChatSessions(active.id, authToken).catch(() => []),
        ]);
        if (cancelled) return;
        setDocumentCount(documents.length);
        const sorted = sortSessions(sessionList);
        setSessions(sorted);
        setSelectedSessionId(sorted[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Unable to load chat studio.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [authToken, collectionId, sortSessions]);

  useEffect(() => {
    if (!authToken || !collectionId) {
      setPromptDetails(null);
      setPromptDraft('');
      return;
    }
    let cancelled = false;
    async function loadPrompt() {
      setPromptLoading(true);
      setPromptError(null);
      try {
        const details = await getCollectionPrompt(collectionId, authToken);
        if (cancelled) return;
        setPromptDetails(details);
        if (!promptEditorOpen) {
          setPromptDraft(details.template ?? '');
        }
      } catch (error) {
        if (!cancelled) {
          setPromptError(error instanceof Error ? error.message : 'Unable to load system prompt.');
        }
      } finally {
        if (!cancelled) {
          setPromptLoading(false);
        }
      }
    }
    loadPrompt();
    return () => {
      cancelled = true;
    };
  }, [authToken, collectionId, promptEditorOpen]);

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      setModelsLoading(true);
      try {
        const items = await listModels(authToken || undefined);
        if (!cancelled) {
          setModelCatalog(items);
          setModelsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setModelsError(error instanceof Error ? error.message : 'Unable to load model metadata.');
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };
    loadModels();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!collection) {
      setActiveModelId(null);
      return;
    }
    setActiveModelId((current) => current ?? collection.chat_model);
  }, [collection]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    const session = sessions.find((item) => item.id === selectedSessionId);
    if (session?.chat_model) {
      setActiveModelId((current) => (current === session.chat_model ? current : session.chat_model));
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!authToken) return;
    if (!selectedSessionId) {
      setMessages([]);
      setToolTraces([]);
      setVisibleMessageIds([]);
      setPendingMessageIds([]);
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    if (pendingSessionIdsRef.current.has(selectedSessionId)) {
      setMessages([]);
      setToolTraces([]);
      setVisibleMessageIds([]);
      setPendingMessageIds([]);
      setUsage(null);
      setContextConsumed(0);
      return;
    }
    let cancelled = false;
    async function loadHistory() {
      try {
        const history = await getChatHistory(selectedSessionId, authToken);
        if (!cancelled) {
          syncMessages(history, { hydrate: true });
          setToolTraces(deriveToolTraces(history));
          setUsage(calculateSessionUsage(history));
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Unable to load chat history.');
        }
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [authToken, selectedSessionId, syncMessages, deriveToolTraces]);

  useEffect(() => {
    if (!selectedSessionId) {
      setOptimisticMessages([]);
      return;
    }
    setOptimisticMessages((prev) =>
      prev.filter((message) => message.session_id === selectedSessionId),
    );
  }, [selectedSessionId]);

  useEffect(() => {
    setOptimisticMessages((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      return prev.filter((optimistic) => {
        const trimmedOptimistic = optimistic.content.trim();
        if (!trimmedOptimistic) {
          return false;
        }
        const duplicate = messages.some(
          (message) =>
            message.session_id === optimistic.session_id &&
            message.role === 'user' &&
            message.content.trim() === trimmedOptimistic &&
            message.id !== optimistic.id,
        );
        return !duplicate;
      });
    });
  }, [messages]);

  useEffect(() => {
    if (!selectedSessionId) {
      setContextConsumed(0);
      return;
    }
    const activeSession = sessions.find((session) => session.id === selectedSessionId);
    if (activeSession) {
      setContextConsumed(activeSession.context_tokens);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    setParameterOverrides({});
  }, [activeModelId]);

  const currentModelInfo = useMemo(() => {
    const lookupId = activeModelId || collection?.chat_model;
    if (!lookupId) return null;
    return (
      modelCatalog.find((model) => model.id === lookupId || model.canonical_slug === lookupId) ??
      null
    );
  }, [activeModelId, collection?.chat_model, modelCatalog]);

  const providerModelSlug = useMemo(() => {
    const slugSource =
      currentModelInfo?.canonical_slug ?? currentModelInfo?.id ?? collection?.chat_model ?? null;
    return sanitizeModelSlug(slugSource);
  }, [collection?.chat_model, currentModelInfo?.canonical_slug, currentModelInfo?.id]);

  const supportedParameterKeys = useMemo(() => {
    const supported = new Set<ModelParameterKey>();
    if (!currentModelInfo) {
      return supported;
    }
    (currentModelInfo.supported_parameters || []).forEach((param) => {
      const normalized = param.toLowerCase();
      if (normalized in PARAMETER_DEFINITION_MAP) {
        supported.add(normalized as ModelParameterKey);
      }
    });
    return supported;
  }, [currentModelInfo]);

  const visibleParameterDefinitions = useMemo(
    () => PARAMETER_DEFINITIONS.filter((definition) => supportedParameterKeys.has(definition.key)),
    [supportedParameterKeys],
  );

  const activeParameterCount = useMemo(() => {
    return Object.keys(parameterOverrides).filter((key) =>
      supportedParameterKeys.has(key as ModelParameterKey),
    ).length;
  }, [parameterOverrides, supportedParameterKeys]);

  const providerPayload = useMemo<ProviderPreferences>(() => {
    const payload: ProviderPreferences = {};
    if (providerForm.order.length > 0) {
      payload.order = providerForm.order;
    }
    if (providerForm.only.length > 0) {
      payload.only = providerForm.only;
    }
    if (providerForm.ignore.length > 0) {
      payload.ignore = providerForm.ignore;
    }
    if (providerForm.quantizations.length > 0) {
      payload.quantizations = providerForm.quantizations.map((entry) => entry.toLowerCase());
    }
    if (providerForm.sort) {
      payload.sort = providerForm.sort;
    }
    if (!providerForm.allowFallbacks) {
      payload.allow_fallbacks = false;
    }
    if (providerForm.requireParameters) {
      payload.require_parameters = true;
    }
    if (providerForm.dataCollection === 'deny') {
      payload.data_collection = 'deny';
    }
    if (providerForm.zdr) {
      payload.zdr = true;
    }
    if (providerForm.enforceDistillableText) {
      payload.enforce_distillable_text = true;
    }
    const maxPrice: ProviderPreferences['max_price'] = {};
    const promptPrice = parsePriceInput(providerForm.maxPrompt);
    if (promptPrice !== null) {
      maxPrice.prompt = promptPrice;
    }
    const completionPrice = parsePriceInput(providerForm.maxCompletion);
    if (completionPrice !== null) {
      maxPrice.completion = completionPrice;
    }
    const requestPrice = parsePriceInput(providerForm.maxRequest);
    if (requestPrice !== null) {
      maxPrice.request = requestPrice;
    }
    const imagePrice = parsePriceInput(providerForm.maxImage);
    if (imagePrice !== null) {
      maxPrice.image = imagePrice;
    }
    if (maxPrice && Object.keys(maxPrice).length > 0) {
      payload.max_price = maxPrice;
    }
    return payload;
  }, [providerForm]);

  const providerRuleCount = useMemo(() => Object.keys(providerPayload).length, [providerPayload]);

  useEffect(() => {
    if (!providerModelSlug) {
      setProviderDirectory(null);
      setProviderDirectoryError(null);
      setProviderDirectoryLoading(false);
      return;
    }
    const [author, ...rest] = providerModelSlug.split('/');
    const slugPart = rest.join('/');
    if (!author || !slugPart) {
      setProviderDirectory(null);
      return;
    }
    let cancelled = false;
    setProviderDirectoryLoading(true);
    setProviderDirectoryError(null);
    listModelEndpoints(author, slugPart)
      .then((response) => {
        if (cancelled) return;
        setProviderDirectory(response.data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Unable to load provider catalog.';
        setProviderDirectoryError(message);
        setProviderDirectory(null);
      })
      .finally(() => {
        if (!cancelled) {
          setProviderDirectoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [providerModelSlug]);

  useEffect(() => {
    setProviderSearchTerm('');
  }, [providerModelSlug]);

  const markProgrammaticScroll = useCallback((duration = 150) => {
    if (programmaticScrollTimeoutRef.current) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollRef.current = true;
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimeoutRef.current = null;
    }, duration);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (!endRef.current) {
        return;
      }
      if (scrollAnimationFrameRef.current) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
      markProgrammaticScroll(behavior === 'smooth' ? 600 : 150);
      scrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior });
        scrollAnimationFrameRef.current = null;
      });
    },
    [markProgrammaticScroll],
  );

  useEffect(() => {
    return () => {
      if (scrollAnimationFrameRef.current) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!autoScrollEnabled) {
      return;
    }
    scrollToBottom('smooth');
  }, [autoScrollEnabled, liveReasoningSegments, liveResponse, scrollToBottom, visibleMessageIds]);

  useEffect(() => {
    setAutoScrollEnabled(true);
  }, [selectedSessionId]);

  useEffect(() => {
    setManuallyOpenedReasoningIds(new Set());
    reasoningCacheRef.current.clear();
  }, [selectedSessionId]);

  const handleReasoningToggle = useCallback((messageId: string, isOpen: boolean) => {
    setManuallyOpenedReasoningIds((prev) => {
      if (isOpen) {
        if (prev.has(messageId)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(messageId);
        return next;
      }
      if (!prev.has(messageId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  const getPersistedReasoningSegments = useCallback(
    (messageId: string, segments: ReasoningTraceSegment[]) => {
      if (segments.length > 0) {
        reasoningCacheRef.current.set(messageId, segments);
        return segments;
      }
      return reasoningCacheRef.current.get(messageId) ?? segments;
    },
    [],
  );

  useEffect(
    () => () => {
      if (programmaticScrollTimeoutRef.current) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (liveReasoningSegments.length > 0) {
      setPersistedLiveReasoningSegments(liveReasoningSegments);
    }
  }, [liveReasoningSegments]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    if (programmaticScrollRef.current) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 12) {
      if (autoScrollEnabled) {
        setAutoScrollEnabled(false);
      }
      return;
    }
    if (!autoScrollEnabled && distanceFromBottom <= 2) {
      setAutoScrollEnabled(true);
    }
  }, [autoScrollEnabled]);

  const handleReenableAutoScroll = useCallback(() => {
    setAutoScrollEnabled(true);
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  const showFollowButton =
    !autoScrollEnabled &&
    (messages.length > 0 || hasLiveText || hasDisplayedLiveReasoning);

  useLayoutEffect(() => {
    const textarea = chatPromptRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const fullHeight = textarea.scrollHeight;
    const clampedHeight = Math.max(
      CHAT_INPUT_MIN_HEIGHT,
      Math.min(fullHeight, CHAT_INPUT_MAX_HEIGHT),
    );
    textarea.style.height = `${clampedHeight}px`;
    textarea.style.overflowY = fullHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [draft]);

  const pollSessionHistory = useCallback(
    async (sessionId: string) => {
      if (!authToken) return;
      try {
        const history = await getChatHistory(sessionId, authToken);
        if (activePollingSession.current !== sessionId) {
          return;
        }
        // Hydrate instead of queueing pending reveals so previously streamed bubbles
        // stay mounted while their persisted counterparts arrive.
        syncMessages(history, { hydrate: true });
        setToolTraces(deriveToolTraces(history));
        setUsage(calculateSessionUsage(history));
      } catch {
        // swallow transient polling errors
      }
    },
    [authToken, deriveToolTraces, syncMessages],
  );

  const stopProgressPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    activePollingSession.current = null;
  }, []);

  const startProgressPolling = useCallback(
    (sessionId: string) => {
      if (!authToken) return;
      activePollingSession.current = sessionId;
      void pollSessionHistory(sessionId);
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
      pollIntervalRef.current = window.setInterval(() => {
        void pollSessionHistory(sessionId);
      }, PROGRESS_POLL_INTERVAL);
    },
    [authToken, pollSessionHistory],
  );

  useEffect(() => () => stopProgressPolling(), [stopProgressPolling]);

  useEffect(() => {
    if (!activePollingSession.current) {
      return;
    }
    if (!selectedSessionId || activePollingSession.current !== selectedSessionId) {
      stopProgressPolling();
    }
  }, [selectedSessionId, stopProgressPolling]);

  useEffect(() => {
    if (pendingMessageIds.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const nextId = pendingMessageIds[0];
      const nextMessage = messages.find((msg) => msg.id === nextId);
      if (nextMessage) {
        setVisibleMessageIds((prev) => [...prev, nextId]);
      }
      setPendingMessageIds((prev) => prev.slice(1));
    }, STREAM_REVEAL_DELAY);
    return () => window.clearTimeout(timer);
  }, [pendingMessageIds, messages]);

  const contextUtilization = useMemo(() => {
    if (!contextWindow) return 0;
    return Math.min(100, Math.round((contextConsumed / contextWindow) * 100));
  }, [contextConsumed, contextWindow]);

  const displayedMessages = useMemo(() => {
    if (visibleMessageIds.length === 0) {
      return messages;
    }
    const idSet = new Set(visibleMessageIds);
    return messages.filter((message) => idSet.has(message.id));
  }, [messages, visibleMessageIds]);

  const toolTraceMap = useMemo(() => {
    const map = new Map<string, ToolCallTrace>();
    toolTraces.forEach((trace) => map.set(trace.id, trace));
    return map;
  }, [toolTraces]);

  const pendingRevealCount = pendingMessageIds.length;
  const liveReasoningCount = liveReasoningSegments.length;

  useEffect(() => {
    const inProgress =
      isStreamingResponse || liveReasoningCount > 0 || pendingRevealCount > 0;
    if (inProgress) {
      if (reasoningFocusTimeoutRef.current) {
        window.clearTimeout(reasoningFocusTimeoutRef.current);
        reasoningFocusTimeoutRef.current = null;
      }
      setReasoningFocusActive(true);
      return;
    }
    if (reasoningFocusTimeoutRef.current) {
      window.clearTimeout(reasoningFocusTimeoutRef.current);
    }
    reasoningFocusTimeoutRef.current = window.setTimeout(() => {
      setReasoningFocusActive(false);
      reasoningFocusTimeoutRef.current = null;
    }, 400);
  }, [isStreamingResponse, liveReasoningCount, pendingRevealCount]);

  useEffect(
    () => () => {
      if (reasoningFocusTimeoutRef.current) {
        window.clearTimeout(reasoningFocusTimeoutRef.current);
      }
    },
    [],
  );

  const latestReasoningId = useMemo(() => {
    for (let i = displayedMessages.length - 1; i >= 0; i--) {
      const message = displayedMessages[i];
      if (message.role === 'tool') {
        const trace = message.tool_call_id ? toolTraceMap.get(message.tool_call_id) : null;
        const toolSegments = trace
          ? normalizeReasoningSegments(trace.reasoning)
          : normalizeReasoningSegments(message.reasoning_trace);
        if (toolSegments.length > 0) {
          return `${message.id}-tool-reasoning`;
        }
        continue;
      }
      if (message.role === 'assistant') {
        const reasoningSegments = normalizeReasoningSegments(message.reasoning_trace);
        const assistantSegments = reasoningSegments.filter(
          (segment) => !isToolReasoningSegment(segment),
        );
        if (assistantSegments.length > 0) {
          return `${message.id}-assistant-reasoning`;
        }
      }
    }
    return null;
  }, [displayedMessages, toolTraceMap]);

  useEffect(() => {
    if (!reasoningFocusActive) {
      setActiveReasoningId((prev) => (prev === null ? prev : null));
      return;
    }
    if (liveReasoningCount > 0) {
      setActiveReasoningId((prev) => (prev === 'live-reasoning' ? prev : 'live-reasoning'));
      return;
    }
    setActiveReasoningId((prev) => (prev === latestReasoningId ? prev : latestReasoningId));
  }, [latestReasoningId, liveReasoningCount, reasoningFocusActive]);

  const toolReadyModels = useMemo(
    () =>
      modelCatalog.filter((model) =>
        (model.supported_parameters || []).some((param) => param.toLowerCase() === 'tools'),
      ),
    [modelCatalog],
  );

  const filteredModelCatalog = useMemo(() => {
    const query = modelSearchTerm.trim().toLowerCase();
    if (!query) return toolReadyModels;
    return toolReadyModels.filter((model) => {
      const haystack = [model.name, model.id, model.canonical_slug, model.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [modelSearchTerm, toolReadyModels]);

  const selectedModelKey = useMemo(
    () => activeModelId || collection?.chat_model || '',
    [activeModelId, collection?.chat_model],
  );

  const substitutePromptVariables = useCallback(
    (templateValue: string) => {
      if (!templateValue) return '';
      if (!promptDetails) return templateValue;
      return templateValue.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, rawKey) => {
        const key = String(rawKey).trim();
        return promptDetails.context?.[key] ?? `{{${key}}}`;
      });
    },
    [promptDetails],
  );

  const promptPreviewMarkdown = useMemo(() => {
    if (promptDraft) {
      return substitutePromptVariables(promptDraft);
    }
    if (promptDetails?.template) {
      return substitutePromptVariables(promptDetails.template);
    }
    return promptDetails?.rendered ?? '';
  }, [promptDraft, promptDetails, substitutePromptVariables]);

  const promptHasChanges = useMemo(() => {
    if (!promptDetails) {
      return Boolean(promptDraft);
    }
    const original = promptDetails.template ?? '';
    return promptDraft !== original;
  }, [promptDetails, promptDraft]);


  const applyChatResponse = useCallback(
    (response: ChatCompletionPayload, options: { hydrate?: boolean } = {}) => {
      setLiveResponse('');
      setIsStreamingResponse(false);
      resetLiveReasoningState();
      pendingSessionIdsRef.current.delete(response.session.id);
      const enrichedMessages = attachUsageToLastAssistantMessage(
        response.messages,
        response.usage ?? null,
      );
      // Always hydrate when streaming to prevent delayed message reveals
      syncMessages(enrichedMessages, { hydrate: true });
      const nextToolTraces =
        response.tool_traces && response.tool_traces.length > 0
          ? response.tool_traces
          : deriveToolTraces(response.messages);
      setToolTraces(nextToolTraces);
      setUsage(calculateSessionUsage(enrichedMessages) ?? response.usage ?? null);
      setContextConsumed(response.context_consumed);
      setContextWindow(response.context_window || collection?.context_window || 0);
      setSelectedSessionId(response.session.id);
      setActiveModelId(response.session.chat_model);
      setSessions((prev) => {
        const next = [...prev];
        const idx = next.findIndex((session) => session.id === response.session.id);
        if (idx >= 0) {
          next[idx] = response.session;
        } else {
          next.push(response.session);
        }
        return sortSessions(next);
      });
    },
    [collection, deriveToolTraces, resetLiveReasoningState, sortSessions, syncMessages],
  );

  const isAbortError = (value: unknown): value is DOMException =>
    value instanceof DOMException && value.name === 'AbortError';

  const handleSend = async () => {
    if (!authToken || !collection) return;
    const targetModelId = activeModelId || collection.chat_model;
    if (!targetModelId) {
      setStatus('Select a chat model before sending a message.');
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) return;
    let sessionId = selectedSessionId;
    const isNewSession = !sessionId;
    if (!sessionId) {
      sessionId = generateClientSessionId();
      setSelectedSessionId(sessionId);
      const placeholderSession: ChatSession = {
        id: sessionId,
        collection_id: collection.id,
        user_id: collection.user_id,
        title: `Chat ${new Date().toLocaleTimeString()}`,
        mode: 'chat',
        chat_model: targetModelId,
        context_tokens: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSessions((prev) => sortSessions([...prev, placeholderSession]));
      pendingSessionIdsRef.current.add(sessionId);
    }
    if (!sessionId) return;

    setDraft('');
    const placeholderMessageId = generateClientMessageId();
    const placeholderMessage: ChatMessage = {
      id: placeholderMessageId,
      session_id: sessionId,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setOptimisticMessages((prev) => [...prev, placeholderMessage]);

    const parameterPayload = buildParameterPayload();
    const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
    const provider = providerRuleCount > 0 ? providerPayload : undefined;
    setLiveResponse('');
    setIsStreamingResponse(false);
    resetLiveReasoningState();
    try {
      await performChatMutation(sessionId, {
        content: trimmed,
        mode: 'chat',
        title: isNewSession ? `Chat ${new Date().toLocaleTimeString()}` : undefined,
        chat_model: targetModelId,
        parameters,
        provider,
        stream: streamingEnabled,
      });
    } catch (error) {
      const aborted = isAbortError(error);
      if (sessionId) {
        pendingSessionIdsRef.current.delete(sessionId);
      }
      if (!aborted) {
        setDraft(trimmed);
      }
      if (isNewSession && sessionId && !aborted) {
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        setSelectedSessionId(null);
      }
      if (!aborted) {
        const statusMessage =
          error instanceof Error ? error.message : 'Unable to send your message.';
        setStatus(statusMessage);
      }
    } finally {
      setOptimisticMessages((prev) =>
        prev.filter((message) => message.id !== placeholderMessageId),
      );
    }
  };

  const handleStopGeneration = useCallback(() => {
    if (!sending) {
      return;
    }
    setIsStopping(true);
    abortControllerRef.current?.abort();
    stopProgressPolling();
  }, [sending, stopProgressPolling]);

  const runEditMutation = async (messageId: string, newContent: string) => {
    if (!authToken || !collection || !selectedSessionId) return;
    const targetModelId = activeModelId || collection.chat_model;
    if (!targetModelId) {
      setStatus('Select a chat model before sending a message.');
      return;
    }
    const parameterPayload = buildParameterPayload();
    const parameters = Object.keys(parameterPayload).length > 0 ? parameterPayload : undefined;
    const provider = providerRuleCount > 0 ? providerPayload : undefined;
    try {
      await performChatMutation(selectedSessionId, {
        content: newContent,
        edit_message_id: messageId,
        mode: 'chat',
        chat_model: targetModelId,
        parameters,
        provider,
        stream: streamingEnabled,
      });
      setEditingMessageId(null);
      setEditingDraft('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to edit this turn.');
    }
  };

  const handleEditSubmit = async () => {
    if (!editingMessageId) return;
    const trimmed = editingDraft.trim();
    if (!trimmed) {
      setStatus('Edited message cannot be empty.');
      return;
    }
    await runEditMutation(editingMessageId, trimmed);
  };

  const handleRetryAssistant = async (messageId: string) => {
    await runEditMutation(messageId, '');
  };

  const handleStartNewChat = () => {
    stopProgressPolling();
    setSelectedSessionId(null);
    pendingSessionIdsRef.current.clear();
    setMessages([]);
    setToolTraces([]);
    setVisibleMessageIds([]);
    setPendingMessageIds([]);
    setUsage(null);
    setContextConsumed(0);
    setDraft('');
    setLiveResponse('');
    setIsStreamingResponse(false);
    resetLiveReasoningState();
    setEditingMessageId(null);
    setEditingDraft('');
    setOptimisticMessages([]);
  };

  const handleExportChatHistory = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const sortedMessages = sortMessagesChronologically(messages);
    const payload = { messages: sortedMessages };
    const titleSegment = sanitizeFileName(
      sessions.find((session) => session.id === selectedSessionId)?.title ?? null,
    );
    const idSegment = sanitizeFileName(selectedSessionId ?? null);
    const fallbackSegment =
      titleSegment || idSegment || sanitizeFileName(new Date().toISOString());
    const fileName = `chat-history-${fallbackSegment || Date.now().toString(36)}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [messages, selectedSessionId, sessions]);

  const handlePromptEditorOpen = useCallback(() => {
    if (promptDetails) {
      setPromptDraft(promptDetails.template ?? '');
    }
    setPromptEditorOpen(true);
    window.setTimeout(() => {
      promptEditorRef.current?.focus();
    }, 20);
  }, [promptDetails]);

  const handlePromptEditorClose = useCallback(() => {
    setPromptEditorOpen(false);
  }, []);

  const handleInsertPromptVariable = useCallback((variableName: string) => {
    const insertion = `{{${variableName}}}`;
    setPromptDraft((prev) => {
      const textarea = promptEditorRef.current;
      if (textarea) {
        const start = textarea.selectionStart ?? prev.length;
        const end = textarea.selectionEnd ?? prev.length;
        const next = prev.slice(0, start) + insertion + prev.slice(end);
        window.requestAnimationFrame(() => {
          const cursor = start + insertion.length;
          textarea.selectionStart = cursor;
          textarea.selectionEnd = cursor;
          textarea.focus();
        });
        return next;
      }
      const spacer = prev.endsWith(' ') || prev.endsWith('\n') || prev.length === 0 ? '' : ' ';
      return `${prev}${spacer}${insertion}`;
    });
  }, []);

  const handlePromptReset = useCallback(() => {
    setPromptDraft('');
    window.requestAnimationFrame(() => {
      promptEditorRef.current?.focus();
    });
  }, []);

  const handlePromptSave = useCallback(async () => {
    if (!authToken || !collectionId) {
      setPromptError('Sign in to update the system prompt.');
      return;
    }
    setPromptSaving(true);
    setPromptError(null);
    try {
      const updated = await updateCollectionPrompt(collectionId, promptDraft, authToken);
      setPromptDetails(updated);
      setPromptDraft(updated.template ?? '');
      setPromptEditorOpen(false);
    } catch (error) {
      setPromptError(
        error instanceof Error ? error.message : 'Unable to update the system prompt right now.',
      );
    } finally {
      setPromptSaving(false);
    }
  }, [authToken, collectionId, promptDraft]);

  const handleDeleteSession = async (sessionId: string) => {
    if (!authToken) return;
    setStatus(null);
    setDeletingSessionId(sessionId);
    try {
      await deleteChatSession(sessionId, authToken);
      let nextSelectedId: string | null = null;
      setSessions((prev) => {
        const next = prev.filter((session) => session.id !== sessionId);
        if (selectedSessionId === sessionId) {
          nextSelectedId = next[0]?.id ?? null;
        }
        return next;
      });
      if (selectedSessionId === sessionId) {
        if (nextSelectedId) {
          setSelectedSessionId(nextSelectedId);
        } else {
          handleStartNewChat();
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to delete chat session.');
    } finally {
      setDeletingSessionId((current) => (current === sessionId ? null : current));
    }
  };

  const updateParameterValue = useCallback(
    (key: ModelParameterKey, value?: ParameterValue | null) => {
      setParameterOverrides((prev) => {
        const next = { ...prev };
        if (value === undefined || value === null) {
          delete next[key];
        } else if (typeof value === 'string' && value.trim() === '') {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    },
    [],
  );

  const handleNumberParameterChange = useCallback(
    (key: ModelParameterKey, rawValue: string, asInteger = false) => {
      if (rawValue === '') {
        updateParameterValue(key, undefined);
        return;
      }
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed)) {
        updateParameterValue(key, undefined);
        return;
      }
      updateParameterValue(key, asInteger ? Math.round(parsed) : parsed);
    },
    [updateParameterValue],
  );

  const handleBooleanParameterChange = useCallback(
    (key: ModelParameterKey, checked: boolean) => {
      updateParameterValue(key, checked ? true : undefined);
    },
    [updateParameterValue],
  );

  const handleTextParameterChange = useCallback(
    (key: ModelParameterKey, value: string) => {
      updateParameterValue(key, value);
    },
    [updateParameterValue],
  );

  const handleSelectParameterChange = useCallback(
    (key: ModelParameterKey, value: string) => {
      updateParameterValue(key, value ? value : undefined);
    },
    [updateParameterValue],
  );

  const handleClearParameter = useCallback(
    (key: ModelParameterKey) => {
      updateParameterValue(key, undefined);
    },
    [updateParameterValue],
  );

  const resetAllParameters = useCallback(() => {
    setParameterOverrides({});
  }, []);

  const formatDefaultParameter = useCallback(
    (key: ModelParameterKey) => {
      if (!currentModelInfo?.default_parameters) return null;
      const rawValue = currentModelInfo.default_parameters[key];
      if (rawValue === undefined || rawValue === null) return null;
      if (Array.isArray(rawValue)) {
        return rawValue.join(', ');
      }
      if (typeof rawValue === 'object') {
        try {
          return JSON.stringify(rawValue);
        } catch {
          return String(rawValue);
        }
      }
      return String(rawValue);
    },
    [currentModelInfo],
  );

  const buildParameterPayload = useCallback(() => {
    if (!currentModelInfo) {
      return {};
    }
    const supportedSet = new Set(
      (currentModelInfo.supported_parameters || []).map((param) => param.toLowerCase()),
    );
    const payload: Record<string, unknown> = {};
    Object.entries(parameterOverrides).forEach(([key, rawValue]) => {
      const normalizedKey = key.toLowerCase();
      if (!supportedSet.has(normalizedKey)) {
        return;
      }
      if (rawValue === undefined || rawValue === null) {
        return;
      }
      if (normalizedKey === 'reasoning') {
        if (typeof rawValue === 'string') {
          const trimmedReasoning = rawValue.trim().toLowerCase();
          if (!trimmedReasoning) {
            return;
          }
          payload[normalizedKey] = { effort: trimmedReasoning };
          return;
        }
        if (typeof rawValue === 'object') {
          payload[normalizedKey] = rawValue;
        }
        return;
      }
      if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        if (!trimmed) {
          return;
        }
        payload[normalizedKey] = trimmed;
        return;
      }
      payload[normalizedKey] = rawValue;
    });
    return payload;
  }, [currentModelInfo, parameterOverrides]);

  const performChatMutation = useCallback(
    async (sessionId: string, payload: Omit<ChatRequestPayload, 'session_id'>) => {
      if (!authToken || !collection) {
        throw new Error('Missing authentication context.');
      }
      const controller = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = controller;
      setIsStopping(false);
      setSending(true);
      setStatus(null);
      setLiveResponse('');
      setIsStreamingResponse(false);
      resetLiveReasoningState();
      startProgressPolling(sessionId);
      try {
        const requestPayload: ChatRequestPayload = {
          ...payload,
          session_id: sessionId,
        };
        let result: ChatCompletionPayload | null;
        if (payload.stream) {
          setIsStreamingResponse(true);
          result = await streamChatWithCollection(collection.id, requestPayload, authToken, {
            signal: controller.signal,
            onToken: (token) => {
              if (token) {
                setLiveResponse((prev) => `${prev}${token}`);
              }
            },
            onReasoning: (segments) => {
              setLiveReasoningSegments(segments ?? []);
            },
            onError: (message) => {
              setStatus(message);
            },
          });
        } else {
          result = await chatWithCollection(
            collection.id,
            requestPayload,
            authToken,
            controller.signal,
          );
        }
        if (!result) {
          throw new Error('Streaming response did not complete.');
        }
        applyChatResponse(result, { hydrate: Boolean(payload.stream) });
        return result;
      } catch (error) {
        setIsStreamingResponse(false);
        const shouldClearLiveState = !isAbortError(error);
        if (shouldClearLiveState) {
          setLiveResponse('');
          resetLiveReasoningState();
        }
        throw error;
      } finally {
        stopProgressPolling();
        setSending(false);
        setIsStopping(false);
        abortControllerRef.current = null;
      }
    },
    [
      applyChatResponse,
      authToken,
      collection,
      resetLiveReasoningState,
      startProgressPolling,
      stopProgressPolling,
    ],
  );

  const roleVariants: Record<string, string> = {
    user: 'border-violet-500/40 bg-violet-500/15 text-violet-50',
    assistant: 'border-white/15 bg-white/10 text-white',
    tool: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50',
    system: 'border-slate-500/30 bg-slate-900/60 text-slate-100',
  };

  const renderParameterControl = (definition: ParameterDefinition) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(parameterOverrides, definition.key);
    const currentValue = parameterOverrides[definition.key];
    const defaultDisplay = formatDefaultParameter(definition.key);
    const inputClasses =
      'w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-violet-400';

    let control: ReactNode;
    if (definition.input === 'number' || definition.input === 'integer') {
      control = (
        <input
          type="number"
          min={definition.min}
          max={definition.max}
          step={definition.step ?? (definition.input === 'integer' ? 1 : 0.05)}
          className={inputClasses}
          placeholder={definition.placeholder}
          value={typeof currentValue === 'number' ? currentValue : ''}
          onChange={(event) =>
            handleNumberParameterChange(
              definition.key,
              event.target.value,
              definition.input === 'integer',
            )
          }
        />
      );
    } else if (definition.input === 'boolean') {
      control = (
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-white/30 bg-transparent"
            checked={currentValue === true}
            onChange={(event) => handleBooleanParameterChange(definition.key, event.target.checked)}
          />
          <span>Enable</span>
        </label>
      );
    } else if (definition.input === 'select') {
      control = (
        <select
          className={inputClasses}
          value={typeof currentValue === 'string' ? currentValue : ''}
          onChange={(event) => handleSelectParameterChange(definition.key, event.target.value)}
        >
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    } else {
      control = (
        <textarea
          className={`${inputClasses} h-auto`}
          rows={definition.rows ?? 2}
          placeholder={definition.placeholder}
          value={typeof currentValue === 'string' ? currentValue : ''}
          onChange={(event) => handleTextParameterChange(definition.key, event.target.value)}
        />
      );
    }

    return (
      <div
        key={definition.key}
        className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{definition.label}</p>
            <p className="text-xs text-slate-400">{definition.description}</p>
            {defaultDisplay && (
              <p className="text-[11px] text-slate-500">Default: {defaultDisplay}</p>
            )}
          </div>
          <button
            type="button"
            className="text-xs text-slate-400 transition hover:text-white disabled:opacity-40"
            disabled={!hasOverride}
            onClick={() => handleClearParameter(definition.key)}
          >
            Clear
          </button>
        </div>
        {control}
      </div>
    );
  };

  const renderModelSelector = () => {
    const visibleModels = filteredModelCatalog.slice(0, 50);
    const formatCost = (value?: number | string | null) => formatPricePerMillion(value);

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-300">
              {currentModelInfo?.name || selectedModelKey || 'Select a tool-enabled model'}
            </p>
            {selectedModelKey && (
              <p className="text-[11px] text-slate-500 break-all">{selectedModelKey}</p>
            )}
          </div>
          <div className="text-right text-[11px] uppercase tracking-[0.3em] text-slate-500">
            <span>{toolReadyModels.length} ready</span>
            {modelsLoading && (
              <span className="ml-2 inline-flex items-center gap-1 text-slate-300">
                <Loader className="h-3.5 w-3.5" />
                Syncing
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Only models with OpenAI-compatible tool calling are available. Pick any option to apply it
          to the current or next turn.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            className="w-full rounded-2xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400"
            placeholder="Search OpenRouter models…"
            value={modelSearchTerm}
            onChange={(event) => setModelSearchTerm(event.target.value)}
          />
        </div>
        {modelsError && <p className="text-sm text-rose-300">{modelsError}</p>}
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {modelsLoading && toolReadyModels.length === 0 ? (
            <p className="text-sm text-slate-400">Loading tool-compatible models…</p>
          ) : visibleModels.length === 0 ? (
            <p className="text-sm text-slate-400">
              {modelSearchTerm
                ? `No models match "${modelSearchTerm}".`
                : 'No tool-enabled models available.'}
            </p>
          ) : (
            visibleModels.map((model) => {
              const isSelected =
                (selectedModelKey && model.id === selectedModelKey) ||
                (selectedModelKey && model.canonical_slug === selectedModelKey);
              const contextLabel = model.context_length
                ? `${model.context_length.toLocaleString()} ctx`
                : null;
              const promptLabel = formatCost(model.pricing?.prompt);
              const completionLabel = formatCost(model.pricing?.completion);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setActiveModelId(model.id)}
                  className={cn(
                    'w-full rounded-2xl border px-3 py-2 text-left transition',
                    isSelected
                      ? 'border-violet-400 bg-violet-500/10 text-white'
                      : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{model.name}</p>
                      <p className="text-[11px] text-slate-500 break-all">{model.id}</p>
                    </div>
                    {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-violet-300" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                    {contextLabel && <span>{contextLabel}</span>}
                    {promptLabel && <span>Prompt {promptLabel}</span>}
                    {completionLabel && <span>Completion {completionLabel}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderParameterControls = () => {
    const selectedModelLabel = activeModelId || collection?.chat_model || 'the selected model';
    if (modelsError) {
      return <p className="text-sm text-rose-300">{modelsError}</p>;
    }
    if (modelsLoading && !currentModelInfo) {
      return <p className="text-sm text-slate-400">Loading model catalog…</p>;
    }
    if (!collection) {
      return <p className="text-sm text-slate-400">Select a collection to view model controls.</p>;
    }
    if (!currentModelInfo) {
      return (
        <p className="text-sm text-slate-400">
          Unable to find OpenRouter metadata for <span className="text-white">{selectedModelLabel}</span>.
        </p>
      );
    }
    if (visibleParameterDefinitions.length === 0) {
      return (
        <p className="text-sm text-slate-400">
          This model does not expose the common sampling parameters listed in the OpenRouter docs.
        </p>
      );
    }
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-500">Model</p>
          <p className="text-white">{currentModelInfo.name}</p>
          <p className="text-[11px] text-slate-500 break-all">{currentModelInfo.id}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-slate-500">
            <span>{visibleParameterDefinitions.length} controls</span>
            {activeParameterCount > 0 && (
              <button
                type="button"
                onClick={resetAllParameters}
                className="text-slate-200 underline-offset-4 hover:underline"
              >
                Reset overrides
              </button>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {visibleParameterDefinitions.map((definition) => renderParameterControl(definition))}
        </div>
      </div>
    );
  };

  const renderProviderControls = () => {
    const inputClasses =
      'w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white outline-none focus:border-violet-400';
    const resetProviderPreferences = () => setProviderForm(createDefaultProviderForm());
    const endpoints = providerDirectory?.endpoints ?? [];
    const normalizedSearch = providerSearchTerm.trim().toLowerCase();
    const filteredEndpoints =
      normalizedSearch.length === 0
        ? endpoints
        : endpoints.filter((endpoint) => {
          const haystack = `${endpoint.name} ${endpoint.provider_name ?? ''} ${endpoint.tag ?? ''
            }`.toLowerCase();
          return haystack.includes(normalizedSearch);
        });
    const visibleEndpoints = [...filteredEndpoints].sort((a, b) => {
      const providerCompare = (a.provider_name || '').localeCompare(b.provider_name || '');
      if (providerCompare !== 0) {
        return providerCompare;
      }
      return a.name.localeCompare(b.name);
    });

    const toggleProviderField = (field: ProviderSelectionField, slug: string) => {
      setProviderForm((prev) => {
        const list = prev[field];
        const exists = list.includes(slug);
        const nextList = exists ? list.filter((entry) => entry !== slug) : [...list, slug];
        return { ...prev, [field]: nextList };
      });
    };

    const moveProviderOrderEntry = (slug: string, delta: number) => {
      setProviderForm((prev) => {
        const index = prev.order.indexOf(slug);
        if (index === -1) {
          return prev;
        }
        const target = index + delta;
        if (target < 0 || target >= prev.order.length) {
          return prev;
        }
        const nextOrder = [...prev.order];
        nextOrder.splice(index, 1);
        nextOrder.splice(target, 0, slug);
        return { ...prev, order: nextOrder };
      });
    };

    const renderSelectionField = (
      label: string,
      field: ProviderSelectionField,
      options?: { showIndex?: boolean; allowReorder?: boolean },
    ) => {
      const values = providerForm[field];
      return (
        <div className="space-y-2" key={field}>
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-500">
            <span>{label}</span>
            {values.length === 0 && <span className="text-[10px] text-slate-500">None selected</span>}
          </div>
          {values.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {values.map((slug, index) => (
                <div
                  key={`${field}-${slug}`}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white"
                >
                  {options?.showIndex && <span className="text-[10px] text-slate-400">#{index + 1}</span>}
                  <span className="font-mono text-[11px]">{slug}</span>
                  {options?.allowReorder && values.length > 1 && (
                    <div className="flex items-center gap-1 text-slate-400">
                      <button
                        type="button"
                        className="hover:text-white disabled:opacity-30"
                        onClick={() => moveProviderOrderEntry(slug, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${slug} earlier`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="hover:text-white disabled:opacity-30"
                        onClick={() => moveProviderOrderEntry(slug, 1)}
                        disabled={index === values.length - 1}
                        aria-label={`Move ${slug} later`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="text-slate-300 hover:text-white"
                    onClick={() => toggleProviderField(field, slug)}
                    aria-label={`Remove ${slug}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    const toggleQuantization = (value: string) => {
      setProviderForm((prev) => {
        const exists = prev.quantizations.includes(value);
        const next = exists
          ? prev.quantizations.filter((entry) => entry !== value)
          : [...prev.quantizations, value];
        return { ...prev, quantizations: next };
      });
    };

    const renderProviderCard = (endpoint: ProviderEndpoint, position: number) => {
      const slug = endpoint.name;
      const orderActive = providerForm.order.includes(slug);
      const onlyActive = providerForm.only.includes(slug);
      const ignoreActive = providerForm.ignore.includes(slug);
      const promptPrice = formatProviderPrice(endpoint.pricing?.prompt);
      const completionPrice = formatProviderPrice(
        endpoint.pricing?.completion ?? endpoint.pricing?.request,
      );
      const maxTokens =
        endpoint.max_completion_tokens ??
        endpoint.max_prompt_tokens ??
        endpoint.context_length ??
        null;
      const parameterCount = endpoint.supported_parameters?.length ?? 0;
      const actionClasses = (active: boolean) =>
        cn(
          'rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em]',
          active
            ? 'border-violet-400 bg-violet-500/20 text-white'
            : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/40',
        );
      const cardKey = `${slug}-${endpoint.provider_name ?? 'unknown'}-${endpoint.tag ?? 'default'}-${position}`;
      const quantizationLabel =
        typeof endpoint.quantization === 'string'
          ? endpoint.quantization?.toUpperCase()
          : endpoint.quantization && typeof endpoint.quantization === 'object'
            ? Object.values(endpoint.quantization)
              .filter(Boolean)
              .map((value) => String(value))
              .join(', ')
            : null;
      return (
        <div
          key={cardKey}
          className="space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-black/60 to-black/30 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-white">{slug}</p>
              <p className="text-xs text-slate-400">{endpoint.provider_name || 'Unknown provider'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
              <span>{getEndpointStatusLabel(endpoint.status)}</span>
              <span>Uptime {formatUptimePercentage(endpoint.uptime_last_30m)}</span>
              {endpoint.tag && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-200">
                  {endpoint.tag}
                </span>
              )}
              {endpoint.supports_implicit_caching && (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                  Cache
                </span>
              )}
              {quantizationLabel && (
                <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                  {quantizationLabel}
                </span>
              )}
            </div>
          </div>
          <div className="grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
            <div className="rounded-xl border border-white/5 bg-black/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Prompt</p>
              <p className="text-lg font-semibold text-white">{promptPrice}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Completion</p>
              <p className="text-lg font-semibold text-white">{completionPrice}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Capacity</p>
              <p className="text-lg font-semibold text-white">
                {maxTokens ? `${Math.round(maxTokens).toLocaleString()} tokens` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Supported params</p>
              <p className="text-lg font-semibold text-white">{parameterCount}</p>
            </div>
          </div>
          <div className="grid gap-2 text-center text-xs uppercase tracking-[0.3em] text-white sm:grid-cols-3">
            <button
              type="button"
              className={actionClasses(orderActive)}
              onClick={() => toggleProviderField('order', slug)}
            >
              {orderActive ? 'In order' : 'Add to order'}
            </button>
            <button
              type="button"
              className={actionClasses(onlyActive)}
              onClick={() => toggleProviderField('only', slug)}
            >
              {onlyActive ? 'Allowing' : 'Allow only'}
            </button>
            <button
              type="button"
              className={actionClasses(ignoreActive)}
              onClick={() => toggleProviderField('ignore', slug)}
            >
              {ignoreActive ? 'Ignored' : 'Ignore'}
            </button>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Routing strategy</p>
              <p className="text-sm text-slate-300">
                Nitro/Floor shortcuts map to these settings. Use the catalog below to build a custom
                provider order.
              </p>
            </div>
            {providerRuleCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full border border-white/10 px-3 text-xs text-slate-200"
                onClick={resetProviderPreferences}
              >
                Reset rules
              </Button>
            )}
          </div>
          <label className="space-y-2 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Sort providers</span>
            <select
              className={inputClasses}
              value={providerForm.sort}
              onChange={(event) =>
                setProviderForm((prev) => ({
                  ...prev,
                  sort: event.target.value as ProviderSortChoice,
                }))
              }
            >
              <option value="">Load balance (default)</option>
              <option value="throughput">Throughput (Nitro)</option>
              <option value="price">Price (Floor)</option>
              <option value="latency">Latency</option>
            </select>
          </label>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
              <span className="font-medium text-white">Allow fallbacks</span>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-white/30 bg-transparent"
                checked={providerForm.allowFallbacks}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, allowFallbacks: event.target.checked }))
                }
              />
            </label>
            <p className="mt-1 text-xs text-slate-400">
              Disable this to fail fast if your preferred providers are unavailable.
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Provider catalog</p>
              <p className="text-sm text-slate-300">
                {providerModelSlug
                  ? `Pulled from OpenRouter for ${providerModelSlug}.`
                  : 'Select a model to browse provider endpoints.'}
              </p>
            </div>
            {providerDirectory && (
              <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                {providerDirectory.endpoints.length} endpoints
              </span>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              className={cn(
                inputClasses,
                'pl-9 disabled:cursor-not-allowed disabled:opacity-60',
              )}
              placeholder="Search provider slug, vendor, or tag"
              value={providerSearchTerm}
              onChange={(event) => setProviderSearchTerm(event.target.value)}
              disabled={!providerModelSlug}
            />
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            {providerDirectoryLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader className="h-4 w-4" />
                <span>Loading endpoints…</span>
              </div>
            ) : providerDirectoryError ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                {providerDirectoryError}
              </div>
            ) : !providerModelSlug ? (
              <p className="text-sm text-slate-400">Pick a model to inspect its provider list.</p>
            ) : visibleEndpoints.length === 0 ? (
              <p className="text-sm text-slate-400">
                {normalizedSearch
                  ? 'No providers match your search.'
                  : 'No endpoints published for this model yet.'}
              </p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                {visibleEndpoints.map((endpoint, index) => renderProviderCard(endpoint, index))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Selections & filters</p>
          {renderSelectionField('Order priority', 'order', {
            showIndex: true,
            allowReorder: true,
          })}
          {providerForm.order.length > 0 && (
            <p className="text-[11px] text-slate-500">
              Requests follow this order before falling back to the OpenRouter defaults.
            </p>
          )}
          {renderSelectionField('Allow only', 'only')}
          {renderSelectionField('Ignore', 'ignore')}
          <div className="space-y-2">
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Quantizations</span>
            <div className="flex flex-wrap gap-2">
              {QUANTIZATION_OPTIONS.map((option) => {
                const active = providerForm.quantizations.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    className={cn(
                      'rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em]',
                      active
                        ? 'border-cyan-400 bg-cyan-500/20 text-white'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/40',
                    )}
                    onClick={() => toggleQuantization(option)}
                  >
                    {option.toUpperCase()}
                  </button>
                );
              })}
            </div>
            {providerForm.quantizations.length === 0 ? (
              <p className="text-xs text-slate-500">
                Load balance across all quantization levels.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                {providerForm.quantizations.length} selected • filters apply to open-weight endpoints.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Data guardrails</p>
          <div className="space-y-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <span className="font-medium text-white">Require parameters</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                  checked={providerForm.requireParameters}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, requireParameters: event.target.checked }))
                  }
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Only route to providers that support every parameter in your request.
              </p>
            </div>
            <label className="space-y-2 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Data collection</span>
              <select
                className={inputClasses}
                value={providerForm.dataCollection}
                onChange={(event) =>
                  setProviderForm((prev) => ({
                    ...prev,
                    dataCollection: event.target.value === 'deny' ? 'deny' : 'allow',
                  }))
                }
              >
                <option value="allow">Allow (default)</option>
                <option value="deny">Deny (no collection)</option>
              </select>
            </label>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <span className="font-medium text-white">Zero data retention</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                  checked={providerForm.zdr}
                  onChange={(event) =>
                    setProviderForm((prev) => ({ ...prev, zdr: event.target.checked }))
                  }
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">Only send requests to ZDR endpoints.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <span className="font-medium text-white">Distillable text only</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                  checked={providerForm.enforceDistillableText}
                  onChange={(event) =>
                    setProviderForm((prev) => ({
                      ...prev,
                      enforceDistillableText: event.target.checked,
                    }))
                  }
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Restrict routing to models that permit text distillation.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Max price ($/m tokens)</p>
            <p className="text-sm text-slate-300">
              Cap prompt, completion, request, or image pricing for this turn.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Prompt</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="1.00"
                value={providerForm.maxPrompt}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxPrompt: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Completion</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="2.00"
                value={providerForm.maxCompletion}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxCompletion: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Request</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="0.25"
                value={providerForm.maxRequest}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxRequest: event.target.value }))
                }
              />
            </label>
            <label className="space-y-1 text-sm text-slate-200">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Image</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClasses}
                placeholder="0.02"
                value={providerForm.maxImage}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, maxImage: event.target.value }))
                }
              />
            </label>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Need a refresher? Read the{' '}
          <a
            href="https://openrouter.ai/docs/features/provider-routing"
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 underline decoration-dotted underline-offset-4"
          >
            provider routing guide
          </a>{' '}
          for tips on building multi-provider policies.
        </p>
      </div>
    );
  };

  const renderMessages = () => {
    const dedupedOptimistic = optimisticMessages.filter((optimistic) => {
      const trimmedOptimistic = optimistic.content.trim();
      if (!trimmedOptimistic) {
        return false;
      }
      return !displayedMessages.some(
        (message) =>
          message.session_id === optimistic.session_id &&
          message.role === optimistic.role &&
          message.role === 'user' &&
          message.content.trim() === trimmedOptimistic,
      );
    });
    const allMessages = [...displayedMessages, ...dedupedOptimistic];
    if (allMessages.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-10 text-center">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Ready to chat</p>
            <h3 className="text-3xl font-semibold text-white">
              {collection ? collection.name : 'Select a collection'}
            </h3>
            <p className="text-sm text-slate-400">
              Ask anything about this dataset and we will cite the chunks that back it up.
            </p>
          </div>
          <div className="grid w-full max-w-3xl gap-3 md:grid-cols-2">
            {samplePrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left text-sm text-slate-300 transition hover:border-white/30 hover:text-white"
                onClick={() => setDraft(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      );
    }

    const streamingReasoningBubble = shouldShowStreamingReasoningBubble ? (
      <div key="live-reasoning-stream" className="flex justify-start">
        <div
          className={cn(
            'live-stream-reasoning relative max-w-[75%] rounded-2xl border px-4 py-3 text-sm',
            roleVariants.assistant,
          )}
          data-live-reasoning-key={liveReasoningAnimationKey}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">Reasoning</p>
          </div>
          <CollapsibleReasoning
            segments={liveReasoningDisplaySegments}
            messageId="live-reasoning"
            isAutoOpen={activeReasoningId === 'live-reasoning'}
            preventAutoClose={manuallyOpenedReasoningIds.has('live-reasoning')}
            onManualToggle={handleReasoningToggle}
          />
        </div>
      </div>
    ) : null;
    const assistantTypingBubble = showStreamingBubble ? (
      <div key="typing-indicator" className="flex justify-start">
        <div
          className={cn(
            'live-stream-text relative max-w-[75%] rounded-2xl border px-4 py-3 text-sm',
            roleVariants.assistant,
          )}
          data-live-stream-key={liveResponseAnimationKey}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">ASSISTANT</p>
          </div>
          {showStreamingBubble && hasLiveText ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {liveResponse}
            </ReactMarkdown>
          ) : (
            <TypingAnimation />
          )}
        </div>
      </div>
    ) : null;

    const messageBubbles = allMessages.flatMap((message) => {
      const bubbles: Array<{ key: string; node: ReactNode }> = [];
      const variant = roleVariants[message.role] ?? roleVariants.system;
      const isUser = message.role === 'user';
      const isAssistant = message.role === 'assistant';
      const showActions = (isUser || isAssistant) && !!selectedSessionId;
      const trimmedContent = message.content?.trim() || '';
      const isToolCallPlaceholder =
        isAssistant &&
        !trimmedContent &&
        Array.isArray(message.tool_payload?.tool_calls) &&
        message.tool_payload?.tool_calls.length > 0;
      const displayedContent = trimmedContent || 'No response captured.';
      const messageReasoningSegments = getPersistedReasoningSegments(
        `${message.id}-base`,
        normalizeReasoningSegments(message.reasoning_trace),
      );

      if (isAssistant) {
        const assistantSegments = messageReasoningSegments.filter(
          (segment) => !isToolReasoningSegment(segment),
        );
        if (assistantSegments.length > 0) {
          const reasoningKey = `${message.id}-assistant-reasoning`;
          bubbles.push({
            key: reasoningKey,
            node: (
              <div className="flex justify-start">
                <div className={cn('max-w-[75%] rounded-2xl border px-4 py-3 text-sm', roleVariants.assistant)}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">Reasoning</p>
                  </div>
                  <CollapsibleReasoning
                    segments={assistantSegments}
                    messageId={reasoningKey}
                    isAutoOpen={activeReasoningId === reasoningKey}
                    preventAutoClose={manuallyOpenedReasoningIds.has(reasoningKey)}
                    onManualToggle={handleReasoningToggle}
                  />
                </div>
              </div>
            ),
          });
        }
      }

      if (message.role === 'tool') {
        const trace = message.tool_call_id ? toolTraceMap.get(message.tool_call_id) : null;
        const toolSegments = getPersistedReasoningSegments(
          `${message.id}-tool`,
          trace ? normalizeReasoningSegments(trace.reasoning) : messageReasoningSegments,
        );
        const toolLabel = trace?.name || message.tool_name || 'Tool';
        if (toolSegments.length > 0) {
          const toolReasoningKey = `${message.id}-tool-reasoning`;
          bubbles.push({
            key: toolReasoningKey,
            node: (
              <div className="flex justify-start">
                <div className={cn('max-w-[75%] rounded-2xl border px-4 py-3 text-sm', roleVariants.assistant)}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">
                      Reasoning • {toolLabel}
                    </p>
                  </div>
                  <CollapsibleReasoning
                    segments={toolSegments}
                    messageId={toolReasoningKey}
                    isAutoOpen={activeReasoningId === toolReasoningKey}
                    preventAutoClose={manuallyOpenedReasoningIds.has(toolReasoningKey)}
                    onManualToggle={handleReasoningToggle}
                  />
                </div>
              </div>
            ),
          });
        }

        const rawPayload =
          (message.tool_payload as Record<string, unknown> | null) ??
          safeParseJSON(message.content) ??
          {};
        const payloadRecord: Record<string, unknown> = {
          ...coerceRecord(rawPayload),
          ...(trace
            ? {
                arguments: trace.arguments,
                response: trace.response,
              }
            : {}),
        };
        const argsRecord = coerceRecord(payloadRecord.arguments ?? {});
        const responseRecord = coerceRecord(payloadRecord.response ?? payloadRecord);
        bubbles.push({
          key: `${message.id}-tool`,
          node: (
            <ToolCallBubble
              label={toolLabel}
              variantClass={roleVariants.tool}
              args={argsRecord}
              response={responseRecord}
              rawPayload={payloadRecord}
            />
          ),
        });
        return bubbles.map((b) => <Fragment key={b.key}>{b.node}</Fragment>);
      }

      if (!isToolCallPlaceholder) {
        bubbles.push({
          key: message.id,
          node: (
            <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <div className="group relative max-w-[75%]">
              <div className={cn('rounded-2xl border px-4 py-3 text-sm', variant)}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-300/80">
                    {message.role.toUpperCase()}
                    {message.tool_name ? ` • ${message.tool_name}` : ''}
                  </p>
                  {showActions && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-300">
                      {isUser && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 hover:border-white/30 hover:text-white"
                          onClick={() => {
                            setEditingMessageId(message.id);
                            setEditingDraft(message.content);
                          }}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                      {isAssistant && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 hover:border-white/30 hover:text-white"
                          onClick={() => handleRetryAssistant(message.id)}
                          disabled={sending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isUser && editingMessageId === message.id ? (
                  <div className="space-y-2">
                    <textarea
                      className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
                      value={editingDraft}
                      onChange={(event) => setEditingDraft(event.target.value)}
                    />
                    <div className="flex items-center gap-3">
                      <Button size="sm" onClick={handleEditSubmit} loading={sending}>
                        Update & rerun
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          setEditingMessageId(null);
                          setEditingDraft('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : message.role === 'assistant' ? (
                  <div className="space-y-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {displayedContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayedContent}</p>
                )}
              </div>
              {message.usage && (
                <div className="pointer-events-none absolute left-0 right-0 top-full mt-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400/60">
                    {message.usage.total_tokens != null && (
                      <span>
                        {message.usage.total_tokens.toLocaleString()} tok
                      </span>
                    )}
                    {message.usage.prompt_tokens != null && (
                      <span>
                        {message.usage.prompt_tokens.toLocaleString()} in
                      </span>
                    )}
                    {message.usage.completion_tokens != null && (
                      <span>
                        {message.usage.completion_tokens.toLocaleString()} out
                      </span>
                    )}
                    {message.usage.reasoning_tokens != null && message.usage.reasoning_tokens > 0 && (
                      <span>
                        {message.usage.reasoning_tokens.toLocaleString()} reasoning
                      </span>
                    )}
                    {message.usage.cost != null && (
                      <span className="text-slate-400/80">
                        ${message.usage.cost.toLocaleString(undefined, {
                          minimumFractionDigits: 4,
                          maximumFractionDigits: 6,
                        })}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          ),
        });
      }

      return bubbles.map((b) => <Fragment key={b.key}>{b.node}</Fragment>);
    });

    const streamingBubbles: ReactNode[] = [];
    if (streamingReasoningBubble) streamingBubbles.push(streamingReasoningBubble);
    if (assistantTypingBubble) streamingBubbles.push(assistantTypingBubble);
    return streamingBubbles.length > 0 ? [...messageBubbles, ...streamingBubbles] : messageBubbles;
  };

  const renderHistoryList = () => (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">History</p>
          <h2 className="text-xl font-semibold text-white">Chat sessions</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
          onClick={() => setHistoryOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="border-b border-white/5 px-5 py-3">
        <Button
          variant="secondary"
          className="flex h-10 w-full items-center justify-center gap-2"
          onClick={handleStartNewChat}
        >
          <PlusCircle className="h-4 w-4" />
          <span>New chat</span>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {sessions.length === 0 ? (
          <p className="text-sm text-slate-400">No chats yet — start one below.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => {
              const isSelected = selectedSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-2xl border px-2 py-2 text-sm transition',
                    isSelected
                      ? 'border-violet-400 bg-violet-500/10 text-white'
                      : 'border-white/5 bg-white/5 text-slate-300 hover:border-white/20',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      'flex-1 rounded-xl px-2 py-1 text-left',
                      isSelected ? 'text-white' : 'text-slate-300 group-hover:text-white',
                    )}
                  >
                    <p className="text-base font-semibold">{session.title}</p>
                    <p
                      className={cn(
                        'text-xs',
                        isSelected ? 'text-slate-300' : 'text-slate-400 group-hover:text-slate-200',
                      )}
                    >
                      {session.chat_model} • {timeAgo(session.updated_at)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(session.id)}
                    disabled={deletingSessionId === session.id}
                    title="Delete chat"
                    aria-label={`Delete ${session.title}`}
                    className={cn(
                      'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-slate-400 transition hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50',
                      isSelected
                        ? 'border-white/20 hover:border-rose-300/60'
                        : 'border-white/10 hover:border-rose-300/60',
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderTelemetry = () => {
    const usageCostLabel =
      usage?.cost != null
        ? `$${usage.cost.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        })}`
        : '—';

    const usageDescription = contextWindow
      ? `${contextConsumed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
      : `${contextConsumed.toLocaleString()} tokens consumed`;

    return (
      <div className="flex h-full flex-col min-h-0">
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Context</p>
            <h2 className="text-xl font-semibold text-white">Run settings</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
            onClick={() => setTelemetryOpen(false)}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto">
          <TelemetrySection
            title="System prompt"
            description={
              promptLoading
                ? 'Loading prompt...'
                : promptDetails
                  ? promptDetails.is_custom
                    ? 'Custom template active'
                    : 'Using default template'
                  : promptError || 'Define per-collection instructions'
            }
            icon={<NotebookPen className="h-4 w-4 text-amber-300" />}
            isOpen={systemPromptOpen}
            onToggle={() => setSystemPromptOpen((prev) => !prev)}
          >
            {promptLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader className="h-5 w-5 text-slate-400" />
              </div>
            ) : promptError ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                {promptError}
              </div>
            ) : promptDetails ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Prompt renders with collection metadata and user context. Click any variable in the
                  editor to inject placeholders like{' '}
                  <code className="rounded bg-white/10 px-1 text-[11px] text-violet-200">
                    {'{{collection.name}}'}
                  </code>
                  .
                </p>
                <div className="max-h-48 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {promptDetails.rendered}
                  </ReactMarkdown>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>
                    Generated for{' '}
                    <strong className="text-white">{promptDetails.context?.['datetime.iso']}</strong>
                  </span>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.25em] text-slate-300">
                    {promptDetails.is_custom ? 'Custom template' : 'Default'}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto"
                    onClick={handlePromptEditorOpen}
                  >
                    Edit prompt
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Prompt details unavailable.</p>
            )}
          </TelemetrySection>
          <TelemetrySection
            title="Streaming"
            description={streamingEnabled ? 'Live tokens enabled' : 'Responses buffered until completion'}
            icon={<Share2 className="h-4 w-4 text-emerald-300" />}
            isOpen={streamingOptionsOpen}
            onToggle={() => setStreamingOptionsOpen((prev) => !prev)}
          >
            <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <span className="font-medium text-white">Enable streaming</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                  checked={streamingEnabled}
                  onChange={(event) => setStreamingEnabled(event.target.checked)}
                />
              </label>
              <p className="text-xs text-slate-400">
                Stream OpenRouter completions to this console via Server-Sent Events for real-time feedback.
              </p>
            </div>
          </TelemetrySection>
          <TelemetrySection
            title="Model routing"
            description={
              currentModelInfo?.name || selectedModelKey || 'Select a tool-enabled model'
            }
            icon={<RotateCcw className="h-4 w-4 text-violet-300" />}
            isOpen={modelSelectorOpen}
            onToggle={() => setModelSelectorOpen((prev) => !prev)}
          >
            {renderModelSelector()}
          </TelemetrySection>
          <TelemetrySection
            title="Provider routing"
            description={
              providerRuleCount === 0
                ? 'Load balance across top providers'
                : `${providerRuleCount} routing rule${providerRuleCount === 1 ? '' : 's'} configured`
            }
            icon={<Share2 className="h-4 w-4 text-emerald-300" />}
            isOpen={providerPreferencesOpen}
            onToggle={() => setProviderPreferencesOpen((prev) => !prev)}
          >
            {renderProviderControls()}
          </TelemetrySection>
          <TelemetrySection
            title="Collection vitals"
            description="Current ingestion settings"
            icon={<MessageCircle className="h-4 w-4 text-cyan-300" />}
            isOpen={vitalsOpen}
            onToggle={() => setVitalsOpen((prev) => !prev)}
          >
            {collection ? (
              <div className="space-y-2 text-sm text-slate-300">
                <p>
                  Documents: <span className="text-white">{documentCount}</span>
                </p>
                <p>
                  Embeddings: <span className="text-white">{collection.embedding_model}</span>
                </p>
                <p>
                  Chat model: <span className="text-white">{collection.chat_model}</span>
                </p>
                <p>
                  Chunking:{' '}
                  <span className="text-white">
                    {collection.chunk_settings.strategy} • {collection.chunk_settings.chunk_size}/
                    {collection.chunk_settings.chunk_overlap}
                  </span>
                </p>
                <p>
                  Context window:{' '}
                  <span className="text-white">
                    {collection.context_window.toLocaleString()} tokens
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Loading collection details…</p>
            )}
          </TelemetrySection>

          <TelemetrySection
            title="Model parameters"
            description={
              currentModelInfo
                ? `${activeParameterCount} override${activeParameterCount === 1 ? '' : 's'} active`
                : 'Load model metadata'
            }
            icon={<SlidersHorizontal className="h-4 w-4 text-violet-300" />}
            isOpen={modelParametersOpen}
            onToggle={() => setModelParametersOpen((prev) => !prev)}
          >
            {renderParameterControls()}
          </TelemetrySection>

          <TelemetrySection
            title="Usage"
            description={usageDescription}
            isOpen={usageOpen}
            onToggle={() => setUsageOpen((prev) => !prev)}
          >
            <div className="space-y-3 text-sm text-slate-300">
              <div className="space-y-1 text-xs uppercase tracking-[0.3em] text-slate-400">
                <span>Usage window</span>
                <span className="block text-sm text-slate-300">{usageDescription}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                  style={{ width: `${contextUtilization}%` }}
                />
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                    OpenRouter total cost
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">{usageCostLabel}</p>
                  <p className="text-[11px] text-slate-500">API cost for this session</p>
                </div>
                {usageMetrics.map((metric) => {
                  const metricValue = usage?.[metric.key];
                  const formattedValue =
                    metricValue != null ? metricValue.toLocaleString() : '—';
                  return (
                    <div
                      key={`${metric.key}`}
                      className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center"
                    >
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        {metric.label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-white">{formattedValue}</p>
                    </div>
                  );
                })}
              </div>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-white/30 hover:text-white"
                  onClick={handleExportChatHistory}
                  title="Exports the full chat messages array as formatted JSON"
                >
                  <Share2 className="h-4 w-4" />
                  Export chat history
                </Button>
              </div>
            </div>
          </TelemetrySection>

        </div>
      </div>
    );
  };

  const renderPromptEditorOverlay = () => {
    if (!promptEditorOpen || !promptDetails) {
      return null;
    }
    const variables = promptDetails.variables ?? [];
    const contextEntries = Object.entries(promptDetails.context ?? {});
    const previewSource = promptPreviewMarkdown?.trim()
      ? promptPreviewMarkdown
      : '_No content yet._';
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={handlePromptEditorClose}
        />
        <div className="relative z-10 flex h-[85vh] w-full max-w-6xl flex-col rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">System prompt</p>
              <h2 className="text-2xl font-semibold text-white">Edit collection instructions</h2>
              <p className="text-sm text-slate-400">
                Craft Markdown guidance for this collection. Variables inject metadata, letting the
                prompt stay fresh as the context changes.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 p-0 text-slate-300"
              onClick={handlePromptEditorClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-5 flex flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="flex w-full flex-1 flex-col rounded-2xl border border-white/10 bg-black/30 p-4 lg:w-1/2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-white" htmlFor="system-prompt-editor">
                    Markdown template
                  </label>
                  <button
                    type="button"
                    className="text-xs text-violet-300 hover:text-violet-200"
                    onClick={handlePromptReset}
                  >
                    Revert to default
                  </button>
                </div>
                <textarea
                  id="system-prompt-editor"
                  ref={promptEditorRef}
                  className="mt-3 min-h-[300px] flex-1 resize-none rounded-2xl border border-white/15 bg-black/60 px-4 py-3 font-mono text-sm text-white outline-none focus:border-violet-400"
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  placeholder="Write instructions with Markdown. Use {{collection.name}} style variables."
                />
                <p className="mt-3 text-xs text-slate-500">
                  Leave blank to fall back to the default prompt shipped with TransparentRAG.
                </p>
              </div>
              <div className="flex w-full flex-1 flex-col rounded-2xl border border-white/10 bg-black/30 p-4 lg:w-1/2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Rendered preview</p>
                  <span className="text-xs text-slate-500">
                    {promptDetails.is_custom ? 'Custom template' : 'Default template'}
                  </span>
                </div>
                <div className="mt-3 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-4">
                  <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {previewSource}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Variables</p>
                <p className="mt-1 text-xs text-slate-500">
                  Click a variable to insert it at the cursor. Each one renders with current metadata.
                </p>
                <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                  {variables.map((variable) => (
                    <button
                      key={variable.name}
                      type="button"
                      className="w-full rounded-2xl border border-white/5 bg-black/30 px-3 py-2 text-left transition hover:border-violet-400/60 hover:bg-black/60"
                      onClick={() => handleInsertPromptVariable(variable.name)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <code className="rounded bg-white/10 px-2 py-0.5 text-[12px] text-violet-200">
                          {`{{${variable.name}}}`}
                        </code>
                        {variable.example && (
                          <span className="text-[11px] text-slate-500">
                            Example: <span className="text-slate-300">{variable.example}</span>
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-300">{variable.description}</p>
                    </button>
                  ))}
                  {variables.length === 0 && (
                    <p className="text-sm text-slate-500">No template variables available.</p>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Example context</p>
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1 text-xs">
                  {contextEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-3 border-b border-white/5 py-1 last:border-b-0"
                    >
                      <span className="truncate text-slate-500">{key}</span>
                      <span className="max-w-[60%] truncate text-right text-slate-200">{value}</span>
                    </div>
                  ))}
                  {contextEntries.length === 0 && (
                    <p className="text-slate-500">Context not available yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-white/5 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            {promptEditorOpen && promptError && (
              <p className="text-sm text-rose-300">{promptError}</p>
            )}
            <div className="flex flex-1 justify-end gap-2">
              <Button variant="ghost" onClick={handlePromptEditorClose}>
                Cancel
              </Button>
              <Button
                onClick={handlePromptSave}
                loading={promptSaving}
                disabled={!promptHasChanges || promptSaving}
                className="px-5"
              >
                Save prompt
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <div className="flex h-full flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Chat studio</p>
              <h1 className="text-3xl font-semibold text-white min-w-0 truncate">
                {collection ? collection.name : 'Loading collection…'}
              </h1>
            </div>
            {collection && headerDescription && (
              <p
                className="text-sm text-slate-400 break-words"
                style={{ maxWidth: 'clamp(18rem, 50vw, 40rem)' }}
              >
                {headerDescription}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            className="flex-shrink-0 items-center gap-2 whitespace-nowrap"
            onClick={() => router.push('/chat')}
          >
            <ArrowLeft className="h-4 w-4" />
            Collections
          </Button>
        </div>

        {status && (
          <GlassCard className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
            {status}
          </GlassCard>
        )}

        <div className="flex flex-1 flex-col min-h-0">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <GlassCard className="flex items-center justify-center rounded-[2rem] p-10">
              <Loader className="h-6 w-6" />
            </GlassCard>
          </div>
        ) : !collection ? (
          <div className="flex flex-1 items-center justify-center">
            <GlassCard className="rounded-[2rem] p-10 text-center text-sm text-slate-300">
              Unable to load this collection.
            </GlassCard>
          </div>
        ) : (
          <div className="glass-panel relative flex flex-1 min-h-0 overflow-hidden rounded-[2.5rem] border border-white/5 bg-slate-950/80">
            {historyOpen && (
              <aside className="hidden h-full w-72 flex-shrink-0 border-r border-white/5 bg-black/40 lg:block">
                {renderHistoryList()}
              </aside>
            )}
            {!historyOpen && (
              <button
                type="button"
                className="absolute left-4 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 p-2 text-slate-200 hover:border-white/40 lg:flex"
                onClick={() => setHistoryOpen(true)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}

            <div className="relative flex min-w-0 flex-1 flex-col min-h-0">
              <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Conversation</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold text-white">{collection.name}</h2>
                    <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
                      {documentCount} documents
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!historyOpen && (
                    <Button
                      variant="secondary"
                      className="flex h-10 items-center justify-center gap-2"
                      onClick={handleStartNewChat}
                    >
                      <PlusCircle className="h-4 w-4" />
                      <span>New chat</span>
                    </Button>
                  )}
                </div>
              </div>

                <div className="flex h-full flex-col min-h-0 overflow-hidden">
                  <div
                    ref={messagesContainerRef}
                    onScroll={handleScroll}
                    className="relative flex-1 min-h-0 overflow-y-auto px-16 py-6 scroll-smooth"
                  >
                    <div className="flex h-full flex-col gap-4">
                      {renderMessages()}
                      <div ref={endRef} />
                    </div>
                  </div>
                  {showFollowButton && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-[9rem] flex justify-center">
                      <button
                        type="button"
                        onClick={handleReenableAutoScroll}
                        aria-label="Scroll to latest message"
                        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white opacity-90 shadow-2xl backdrop-blur-sm transition hover:bg-black/80 hover:opacity-100"
                      >
                        <ArrowDown className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                <div className="border-t border-white/5 bg-black/30 px-6 py-4">
                  <div className="flex flex-col gap-3">
                    <textarea
                      ref={chatPromptRef}
                      rows={1}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                      placeholder="Ask anything about this collection…"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      style={{
                        minHeight: CHAT_INPUT_MIN_HEIGHT,
                        maxHeight: CHAT_INPUT_MAX_HEIGHT,
                      }}
                    />
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{draft.length} characters</span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          onClick={sending ? handleStopGeneration : handleSend}
                          disabled={!sending && !draft.trim()}
                          className="gap-2"
                        >
                          {sending ? (isStopping ? 'Stopping...' : 'Stop') : 'Send turn'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {telemetryOpen && (
              <aside className="hidden h-full w-[26rem] flex-shrink-0 border-l border-white/5 bg-black/40 p-6 lg:block">
                {renderTelemetry()}
              </aside>
            )}
            {!telemetryOpen && (
              <button
                type="button"
                className="absolute right-4 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 p-2 text-slate-200 hover:border-white/40 lg:flex"
                onClick={() => setTelemetryOpen(true)}
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    {renderPromptEditorOverlay()}
  </Fragment>
  );
}
