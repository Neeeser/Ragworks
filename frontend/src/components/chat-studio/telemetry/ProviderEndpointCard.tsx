"use client";

import { Chip } from "@/components/ui/chip";
import { Readout } from "@/components/ui/readout";
import { StatusDot } from "@/components/ui/status-dot";
import { formatPricePerMillion } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ProviderFormState, ProviderSelectionField } from "@/components/chat-studio/lib/types";
import type { StatusTone } from "@/components/ui/status-dot";
import type { ProviderEndpoint } from "@/lib/types";

const ENDPOINT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  "0": { label: "Operational", tone: "pos" },
  "-1": { label: "Degraded", tone: "warn" },
  "-2": { label: "Unhealthy", tone: "warn" },
  "-3": { label: "Outage", tone: "neg" },
  "-5": { label: "Offline", tone: "neg" },
  "-10": { label: "Disabled", tone: "neutral" },
};

const formatProviderPrice = (value?: number | string | null): string => {
  return formatPricePerMillion(value) ?? "—";
};

const formatUptimePercentage = (value?: number | null): string => {
  if (value === null || value === undefined) {
    return "N/A";
  }
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
};

const getEndpointStatus = (
  status?: string | number | null,
): { label: string; tone: StatusTone } => {
  if (!status) {
    return { label: "Unknown", tone: "neutral" };
  }
  const key = typeof status === "number" ? String(status) : status;
  return ENDPOINT_STATUS[key] ?? { label: "Unknown", tone: "neutral" };
};

interface ProviderEndpointCardProps {
  endpoint: ProviderEndpoint;
  position: number;
  providerForm: ProviderFormState;
  onToggleField: (field: ProviderSelectionField, slug: string) => void;
}

/** One OpenRouter endpoint for the selected model, with the three routing
 *  decisions that can be taken about it. */
export const ProviderEndpointCard = ({
  endpoint,
  position,
  providerForm,
  onToggleField,
}: ProviderEndpointCardProps) => {
  const slug = endpoint.name;
  const orderActive = providerForm.order.includes(slug);
  const onlyActive = providerForm.only.includes(slug);
  const ignoreActive = providerForm.ignore.includes(slug);
  const promptPrice = formatProviderPrice(endpoint.pricing?.prompt);
  const completionPrice = formatProviderPrice(
    endpoint.pricing?.completion ?? endpoint.pricing?.request,
  );
  const maxTokens =
    endpoint.max_completion_tokens ?? endpoint.max_prompt_tokens ?? endpoint.context_length ?? null;
  const parameterCount = endpoint.supported_parameters?.length ?? 0;
  const status = getEndpointStatus(endpoint.status);
  const actionClasses = (active: boolean) =>
    cn(
      "rounded-control px-2 py-1 text-instrument font-medium transition-colors duration-80 ease-standard",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
      active
        ? "bg-accent-violet/15 text-accent-violet"
        : "bg-surface text-body hover:bg-surface-strong hover:text-primary",
    );
  const cardKey = `${slug}-${endpoint.provider_name ?? "unknown"}-${endpoint.tag ?? "default"}-${position}`;
  const quantizationLabel =
    typeof endpoint.quantization === "string"
      ? endpoint.quantization?.toUpperCase()
      : endpoint.quantization && typeof endpoint.quantization === "object"
        ? Object.values(endpoint.quantization)
            .filter(Boolean)
            .map((value) => String(value))
            .join(", ")
        : null;

  return (
    <div key={cardKey} className="space-y-2 py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-mono text-ui text-primary">{slug}</span>
        <span className="min-w-0 truncate text-instrument text-meta">
          {endpoint.provider_name || "Unknown provider"}
        </span>
        <StatusDot tone={status.tone} label={status.label} className="ml-auto shrink-0" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Readout label="In">{promptPrice}</Readout>
        <Readout label="Out">{completionPrice}</Readout>
        <Readout label="Capacity">
          {maxTokens ? (
            Math.round(maxTokens).toLocaleString()
          ) : (
            <span className="text-muted">—</span>
          )}
        </Readout>
        <Readout label="Params">{parameterCount}</Readout>
        <Readout label="Uptime">{formatUptimePercentage(endpoint.uptime_last_30m)}</Readout>
      </div>
      {(endpoint.tag || endpoint.supports_implicit_caching || quantizationLabel) && (
        <div className="flex flex-wrap gap-1">
          {endpoint.tag && <Chip dot={false}>{endpoint.tag}</Chip>}
          {endpoint.supports_implicit_caching && <Chip tone="pos">Cache</Chip>}
          {quantizationLabel && <Chip tone="chunk">{quantizationLabel}</Chip>}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          aria-pressed={orderActive}
          className={actionClasses(orderActive)}
          onClick={() => onToggleField("order", slug)}
        >
          {orderActive ? "In order" : "Add to order"}
        </button>
        <button
          type="button"
          aria-pressed={onlyActive}
          className={actionClasses(onlyActive)}
          onClick={() => onToggleField("only", slug)}
        >
          {onlyActive ? "Allowing" : "Allow only"}
        </button>
        <button
          type="button"
          aria-pressed={ignoreActive}
          className={actionClasses(ignoreActive)}
          onClick={() => onToggleField("ignore", slug)}
        >
          {ignoreActive ? "Ignored" : "Ignore"}
        </button>
      </div>
    </div>
  );
};
