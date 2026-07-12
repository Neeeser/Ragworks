"use client";

import { Loader, Search } from "lucide-react";

import { useProviderRoutingForm } from "@/components/chat-studio/hooks/settings/use-provider-routing-form";
import { ProviderEndpointCard } from "@/components/chat-studio/telemetry/ProviderEndpointCard";
import { ProviderMaxPriceSection } from "@/components/chat-studio/telemetry/ProviderMaxPriceSection";
import { ProviderSelectionFieldList } from "@/components/chat-studio/telemetry/ProviderSelectionFieldList";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ProviderFormState } from "@/components/chat-studio/lib/types";
import type { ModelEndpointDirectory } from "@/lib/types";

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

interface ProviderRoutingCardProps {
  providerForm: ProviderFormState;
  setProviderForm: (updater: (prev: ProviderFormState) => ProviderFormState) => void;
  providerDirectory: ModelEndpointDirectory | null;
  providerDirectoryLoading: boolean;
  providerDirectoryError: string | null;
  providerModelSlug: string | null;
  providerSearchTerm: string;
  onProviderSearchChange: (value: string) => void;
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
  onProviderSearchChange,
  providerRuleCount,
  resetProviderPreferences,
}: ProviderRoutingCardProps) => {
  const inputClasses =
    "w-full rounded-2xl border border-hairline bg-surface px-4 py-2.5 text-sm text-primary outline-none focus:border-accent-violet";
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

  const { toggleProviderField, moveProviderOrderEntry, toggleQuantization } =
    useProviderRoutingForm(setProviderForm);

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              Routing strategy
            </p>
            <p className="text-sm text-body">
              Nitro/Floor shortcuts map to these settings. Use the catalog below to build a custom
              provider order.
            </p>
          </div>
          {providerRuleCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full border border-hairline px-3 text-xs text-body"
              onClick={resetProviderPreferences}
            >
              Reset rules
            </Button>
          )}
        </div>
        <label className="space-y-2 text-sm text-body">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Sort providers
          </span>
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
        <div className="rounded-2xl border border-hairline bg-surface p-3">
          <label className="flex items-center justify-between gap-3 text-sm text-body">
            <span className="font-medium text-primary">Allow fallbacks</span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-strong bg-transparent"
              checked={providerForm.allowFallbacks}
              onChange={(event) =>
                setProviderForm((prev) => ({ ...prev, allowFallbacks: event.target.checked }))
              }
            />
          </label>
          <p className="mt-1 text-xs text-muted">
            Disable this to fail fast if your preferred providers are unavailable.
          </p>
        </div>
      </div>

      <div className="space-y-4 border-t border-hairline pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              Provider catalog
            </p>
            <p className="text-sm text-body">
              {providerModelSlug
                ? `Pulled from OpenRouter for ${providerModelSlug}.`
                : "Select a model to browse provider endpoints."}
            </p>
          </div>
          {providerDirectory && (
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-meta">
              {providerDirectory.endpoints.length} endpoints
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
          <input
            type="search"
            className={cn(inputClasses, "pl-9 disabled:cursor-not-allowed disabled:opacity-60")}
            placeholder="Search provider slug, vendor, or tag"
            value={providerSearchTerm}
            onChange={(event) => onProviderSearchChange(event.target.value)}
            disabled={!providerModelSlug}
          />
        </div>
        <div>
          {providerDirectoryLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader className="h-4 w-4" />
              <span>Loading endpoints…</span>
            </div>
          ) : providerDirectoryError ? (
            <div className="rounded-xl border border-data-neg/30 bg-data-neg/10 p-3 text-sm text-data-neg">
              {providerDirectoryError}
            </div>
          ) : !providerModelSlug ? (
            <p className="text-sm text-muted">Pick a model to inspect its provider list.</p>
          ) : visibleEndpoints.length === 0 ? (
            <p className="text-sm text-muted">
              {normalizedSearch
                ? "No providers match your search."
                : "No endpoints published for this model yet."}
            </p>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
              {visibleEndpoints.map((endpoint, index) => (
                <ProviderEndpointCard
                  key={`${endpoint.name}-${endpoint.provider_name ?? "unknown"}-${endpoint.tag ?? "default"}-${index}`}
                  endpoint={endpoint}
                  position={index}
                  providerForm={providerForm}
                  onToggleField={toggleProviderField}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 border-t border-hairline pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Selections & filters
        </p>
        <ProviderSelectionFieldList
          label="Order priority"
          fieldKey="order"
          values={providerForm.order}
          showIndex
          allowReorder
          onRemove={(slug) => toggleProviderField("order", slug)}
          onMove={moveProviderOrderEntry}
        />
        {providerForm.order.length > 0 && (
          <p className="text-[11px] text-meta">
            Requests follow this order before falling back to the OpenRouter defaults.
          </p>
        )}
        <ProviderSelectionFieldList
          label="Allow only"
          fieldKey="only"
          values={providerForm.only}
          onRemove={(slug) => toggleProviderField("only", slug)}
          onMove={moveProviderOrderEntry}
        />
        <ProviderSelectionFieldList
          label="Ignore"
          fieldKey="ignore"
          values={providerForm.ignore}
          onRemove={(slug) => toggleProviderField("ignore", slug)}
          onMove={moveProviderOrderEntry}
        />
        <div className="space-y-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Quantizations
          </span>
          <div className="flex flex-wrap gap-2">
            {QUANTIZATION_OPTIONS.map((option) => {
              const active = providerForm.quantizations.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  className={cn(
                    "rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] transition",
                    active
                      ? "border-accent-cyan bg-accent-cyan/20 text-primary"
                      : "border-hairline bg-surface text-body hover:border-strong",
                  )}
                  onClick={() => toggleQuantization(option)}
                >
                  {option.toUpperCase()}
                </button>
              );
            })}
          </div>
          {providerForm.quantizations.length === 0 ? (
            <p className="text-xs text-meta">Load balance across all quantization levels.</p>
          ) : (
            <p className="text-xs text-meta">
              {providerForm.quantizations.length} selected • filters apply to open-weight endpoints.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-hairline pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Data guardrails
        </p>
        <div className="space-y-2">
          <div className="rounded-2xl border border-hairline bg-surface p-3">
            <label className="flex items-center justify-between gap-3 text-sm text-body">
              <span className="font-medium text-primary">Require parameters</span>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-strong bg-transparent"
                checked={providerForm.requireParameters}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, requireParameters: event.target.checked }))
                }
              />
            </label>
            <p className="mt-1 text-xs text-muted">
              Only route to providers that support every parameter in your request.
            </p>
          </div>
          <label className="space-y-2 text-sm text-body">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
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
          <div className="rounded-2xl border border-hairline bg-surface p-3">
            <label className="flex items-center justify-between gap-3 text-sm text-body">
              <span className="font-medium text-primary">Zero data retention</span>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-strong bg-transparent"
                checked={providerForm.zdr}
                onChange={(event) =>
                  setProviderForm((prev) => ({ ...prev, zdr: event.target.checked }))
                }
              />
            </label>
            <p className="mt-1 text-xs text-muted">Only send requests to ZDR endpoints.</p>
          </div>
          <div className="rounded-2xl border border-hairline bg-surface p-3">
            <label className="flex items-center justify-between gap-3 text-sm text-body">
              <span className="font-medium text-primary">Distillable text only</span>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-strong bg-transparent"
                checked={providerForm.enforceDistillableText}
                onChange={(event) =>
                  setProviderForm((prev) => ({
                    ...prev,
                    enforceDistillableText: event.target.checked,
                  }))
                }
              />
            </label>
            <p className="mt-1 text-xs text-muted">
              Restrict routing to models that permit text distillation.
            </p>
          </div>
        </div>
      </div>

      <ProviderMaxPriceSection
        providerForm={providerForm}
        setProviderForm={setProviderForm}
        inputClasses={inputClasses}
      />

      <p className="text-xs text-meta">
        Need a refresher? Read the{" "}
        <a
          href="https://openrouter.ai/docs/features/provider-routing"
          target="_blank"
          rel="noreferrer"
          className="text-accent-cyan underline decoration-dotted underline-offset-4"
        >
          provider routing guide
        </a>{" "}
        for tips on building multi-provider policies.
      </p>
    </div>
  );
};
