"use client";

import { ArrowDown, ArrowUp, Loader, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ProviderFormState, ProviderSelectionField } from "@/components/chat-studio/types";
import type { ModelEndpointDirectory, ProviderEndpoint } from "@/lib/types";

const QUANTIZATION_OPTIONS = [
  "int4",
  "int8",
  "fp4",
  "fp6",
  "fp8",
  "fp16",
  "bf16",
  "fp32",
  "unknown",
] as const;

const ENDPOINT_STATUS_LABELS: Record<string, string> = {
  "0": "Operational",
  "-1": "Degraded",
  "-2": "Unhealthy",
  "-3": "Outage",
  "-5": "Offline",
  "-10": "Disabled",
};

const formatProviderPrice = (value?: number | string | null): string => {
  return formatPricePerMillion(value) ?? "—";
};

const formatPricePerMillion = (value?: number | string | null): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parseNumber = (input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const cleaned = trimmed.replace(/[^0-9eE.+-]/g, "");
    if (!cleaned) {
      return null;
    }
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const raw = typeof value === "number" ? value : parseNumber(String(value));
  if (raw === null || !Number.isFinite(raw)) {
    const fallback = String(value).trim();
    return fallback || null;
  }
  const pricePerMillion = raw * 1_000_000;
  const trimFractionDigits = (numericString: string, minFractionDigits: number) => {
    if (!numericString.includes(".")) {
      return numericString;
    }
    const [whole, fraction] = numericString.split(".");
    if (fraction.length <= minFractionDigits) {
      return `${whole}.${fraction.padEnd(minFractionDigits, "0")}`;
    }
    let trimmedFraction = fraction;
    while (trimmedFraction.length > minFractionDigits && trimmedFraction.endsWith("0")) {
      trimmedFraction = trimmedFraction.slice(0, -1);
    }
    /* c8 ignore next -- minFractionDigits is never zero when a fraction exists */
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

const formatUptimePercentage = (value?: number | null): string => {
  if (value === null || value === undefined) {
    return "N/A";
  }
  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
};

const getEndpointStatusLabel = (status?: string | number | null): string => {
  if (!status) {
    return "Unknown";
  }
  const key = typeof status === "number" ? String(status) : status;
  return ENDPOINT_STATUS_LABELS[key] ?? "Unknown";
};

interface ProviderRoutingCardProps {
  providerForm: ProviderFormState;
  setProviderForm: (updater: (prev: ProviderFormState) => ProviderFormState) => void;
  providerDirectory: ModelEndpointDirectory | null;
  providerDirectoryLoading: boolean;
  providerDirectoryError: string | null;
  providerModelSlug: string | null;
  providerSearchTerm: string;
  setProviderSearchTerm: (value: string) => void;
  providerRuleCount: number;
  resetProviderPreferences: () => void;
}

export const ProviderRoutingCard = ({
  providerForm,
  setProviderForm,
  providerDirectory,
  providerDirectoryLoading,
  providerDirectoryError,
  providerModelSlug,
  providerSearchTerm,
  setProviderSearchTerm,
  providerRuleCount,
  resetProviderPreferences,
}: ProviderRoutingCardProps) => {
  const inputClasses =
    "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white outline-none focus:border-violet-400";
  const endpoints = providerDirectory?.endpoints ?? [];
  const normalizedSearch = providerSearchTerm.trim().toLowerCase();
  const filteredEndpoints =
    normalizedSearch.length === 0
      ? endpoints
      : endpoints.filter((endpoint) => {
          const haystack = `${endpoint.name} ${endpoint.provider_name ?? ""} ${
            endpoint.tag ?? ""
          }`.toLowerCase();
          return haystack.includes(normalizedSearch);
        });
  const visibleEndpoints = [...filteredEndpoints].sort((a, b) => {
    const providerCompare = (a.provider_name || "").localeCompare(b.provider_name || "");
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

  const toggleQuantization = (value: string) => {
    setProviderForm((prev) => {
      const exists = prev.quantizations.includes(value);
      const next = exists
        ? prev.quantizations.filter((entry) => entry !== value)
        : [...prev.quantizations, value];
      return { ...prev, quantizations: next };
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
                {options?.showIndex && (
                  <span className="text-[10px] text-slate-400">#{index + 1}</span>
                )}
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
        "rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em]",
        active
          ? "border-violet-400 bg-violet-500/20 text-white"
          : "border-white/10 bg-white/5 text-slate-200 hover:border-white/40",
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
      <div
        key={cardKey}
        className="space-y-4 rounded-2xl border border-white/10 bg-gradient-to-b from-black/60 to-black/30 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-sm text-white">{slug}</p>
            <p className="text-xs text-slate-400">{endpoint.provider_name || "Unknown provider"}</p>
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
              {maxTokens ? `${Math.round(maxTokens).toLocaleString()} tokens` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Supported params
            </p>
            <p className="text-lg font-semibold text-white">{parameterCount}</p>
          </div>
        </div>
        <div className="grid gap-2 text-center text-xs uppercase tracking-[0.3em] text-white sm:grid-cols-3">
          <button
            type="button"
            className={actionClasses(orderActive)}
            onClick={() => toggleProviderField("order", slug)}
          >
            {orderActive ? "In order" : "Add to order"}
          </button>
          <button
            type="button"
            className={actionClasses(onlyActive)}
            onClick={() => toggleProviderField("only", slug)}
          >
            {onlyActive ? "Allowing" : "Allow only"}
          </button>
          <button
            type="button"
            className={actionClasses(ignoreActive)}
            onClick={() => toggleProviderField("ignore", slug)}
          >
            {ignoreActive ? "Ignored" : "Ignore"}
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
                sort: event.target.value as ProviderFormState["sort"],
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
                : "Select a model to browse provider endpoints."}
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
            className={cn(inputClasses, "pl-9 disabled:cursor-not-allowed disabled:opacity-60")}
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
                ? "No providers match your search."
                : "No endpoints published for this model yet."}
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
        {renderSelectionField("Order priority", "order", {
          showIndex: true,
          allowReorder: true,
        })}
        {providerForm.order.length > 0 && (
          <p className="text-[11px] text-slate-500">
            Requests follow this order before falling back to the OpenRouter defaults.
          </p>
        )}
        {renderSelectionField("Allow only", "only")}
        {renderSelectionField("Ignore", "ignore")}
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
                    "rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em]",
                    active
                      ? "border-cyan-400 bg-cyan-500/20 text-white"
                      : "border-white/10 bg-white/5 text-slate-200 hover:border-white/40",
                  )}
                  onClick={() => toggleQuantization(option)}
                >
                  {option.toUpperCase()}
                </button>
              );
            })}
          </div>
          {providerForm.quantizations.length === 0 ? (
            <p className="text-xs text-slate-500">Load balance across all quantization levels.</p>
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
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Data collection
            </span>
            <select
              className={inputClasses}
              value={providerForm.dataCollection}
              onChange={(event) =>
                setProviderForm((prev) => ({
                  ...prev,
                  dataCollection: event.target.value === "deny" ? "deny" : "allow",
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
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">
            Max price ($/m tokens)
          </p>
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
        Need a refresher? Read the{" "}
        <a
          href="https://openrouter.ai/docs/features/provider-routing"
          target="_blank"
          rel="noreferrer"
          className="text-cyan-300 underline decoration-dotted underline-offset-4"
        >
          provider routing guide
        </a>{" "}
        for tips on building multi-provider policies.
      </p>
    </div>
  );
};
