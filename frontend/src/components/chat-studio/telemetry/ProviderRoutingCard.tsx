"use client";

import { Search } from "lucide-react";

import { useProviderRoutingForm } from "@/components/chat-studio/hooks/settings/use-provider-routing-form";
import { ProviderEndpointCard } from "@/components/chat-studio/telemetry/ProviderEndpointCard";
import { ProviderMaxPriceSection } from "@/components/chat-studio/telemetry/ProviderMaxPriceSection";
import { ProviderSelectionFieldList } from "@/components/chat-studio/telemetry/ProviderSelectionFieldList";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomSelect } from "@/components/ui/custom-select";
import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Skeleton } from "@/components/ui/skeleton";
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

const SORT_OPTIONS = [
  { value: "balance", label: "Load balance (default)" },
  { value: "throughput", label: "Throughput (Nitro)" },
  { value: "price", label: "Price (Floor)" },
  { value: "latency", label: "Latency" },
];

const DATA_COLLECTION_OPTIONS = [
  { value: "allow", label: "Allow (default)" },
  { value: "deny", label: "Deny (no collection)" },
];

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

/**
 * OpenRouter provider routing for the selected model: the strategy, the
 * endpoint catalog it applies to, and the data guardrails a request must
 * satisfy before it is routed anywhere.
 */
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
    <div className="space-y-3">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-ui text-body">
            Nitro and Floor are shortcuts for these settings; the catalog below builds a custom
            order.
          </p>
          {providerRuleCount > 0 && (
            <Button variant="ghost" size="sm" onClick={resetProviderPreferences}>
              Reset rules
            </Button>
          )}
        </div>
        <Field label="Sort providers">
          <CustomSelect
            aria-label="Sort providers"
            value={providerForm.sort || "balance"}
            options={SORT_OPTIONS}
            placeholder="Load balance (default)"
            onValueChange={(value) =>
              setProviderForm((prev) => ({
                ...prev,
                sort: (value === "balance" ? "" : value) as ProviderFormState["sort"],
              }))
            }
          />
        </Field>
        <Checkbox
          checked={providerForm.allowFallbacks}
          onChange={(checked) => setProviderForm((prev) => ({ ...prev, allowFallbacks: checked }))}
          label="Allow fallbacks"
          description="With it off, a turn fails rather than routing past your preferred providers."
        />
      </div>

      <div className="space-y-3 border-t border-hairline pt-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-ui text-body">
            {providerModelSlug
              ? `Endpoints OpenRouter publishes for ${providerModelSlug}.`
              : "Provider routing applies to OpenRouter models only."}
          </p>
          {providerDirectory && (
            <span className="shrink-0 font-mono text-instrument tabular-nums text-meta">
              {providerDirectory.endpoints.length}
            </span>
          )}
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-meta"
          />
          <TextInput
            type="search"
            aria-label="Search providers"
            className={cn("pl-7 disabled:cursor-not-allowed disabled:opacity-60")}
            placeholder="Search provider slug, vendor, or tag"
            value={providerSearchTerm}
            onChange={(event) => onProviderSearchChange(event.target.value)}
            disabled={!providerModelSlug}
          />
        </div>
        <div>
          {providerDirectoryLoading ? (
            <div className="space-y-2" aria-busy>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-14 w-full" />
              ))}
              <span className="sr-only">Loading endpoints…</span>
            </div>
          ) : providerDirectoryError ? (
            <p className="text-ui text-data-neg">{providerDirectoryError}</p>
          ) : !providerModelSlug ? (
            <p className="text-ui text-muted">Pick a model to inspect its provider list.</p>
          ) : visibleEndpoints.length === 0 ? (
            <p className="text-ui text-muted">
              {normalizedSearch
                ? "No providers match your search."
                : "No endpoints published for this model yet."}
            </p>
          ) : (
            <div className="max-h-96 divide-y divide-hairline overflow-y-auto">
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

      <div className="space-y-3 border-t border-hairline pt-3">
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
          <p className="text-instrument text-meta">
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
        <div className="space-y-1">
          <InstrumentLabel>Quantizations</InstrumentLabel>
          <div className="grid grid-cols-3 gap-1">
            {QUANTIZATION_OPTIONS.map((option) => {
              const active = providerForm.quantizations.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  className={cn(
                    "rounded-control py-1 text-center font-mono text-instrument transition-colors duration-80 ease-standard",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-inset",
                    active
                      ? "bg-accent-cyan/15 text-accent-cyan"
                      : "bg-surface text-body hover:bg-surface-strong hover:text-primary",
                  )}
                  onClick={() => toggleQuantization(option)}
                >
                  {option.toUpperCase()}
                </button>
              );
            })}
          </div>
          {providerForm.quantizations.length > 0 && (
            <p className="text-instrument text-meta">
              {providerForm.quantizations.length} selected · applies to open-weight endpoints.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-hairline pt-3">
        <Checkbox
          checked={providerForm.requireParameters}
          onChange={(checked) =>
            setProviderForm((prev) => ({ ...prev, requireParameters: checked }))
          }
          label="Require parameters"
          description="Only route to providers that support every parameter in the request."
        />
        <Field label="Data collection">
          <CustomSelect
            aria-label="Data collection"
            value={providerForm.dataCollection}
            options={DATA_COLLECTION_OPTIONS}
            placeholder="Allow (default)"
            onValueChange={(value) =>
              setProviderForm((prev) => ({
                ...prev,
                dataCollection: value === "deny" ? "deny" : "allow",
              }))
            }
          />
        </Field>
        <Checkbox
          checked={providerForm.zdr}
          onChange={(checked) => setProviderForm((prev) => ({ ...prev, zdr: checked }))}
          label="Zero data retention"
          description="Only send requests to ZDR endpoints."
        />
        <Checkbox
          checked={providerForm.enforceDistillableText}
          onChange={(checked) =>
            setProviderForm((prev) => ({ ...prev, enforceDistillableText: checked }))
          }
          label="Distillable text only"
          description="Restrict routing to models that permit text distillation."
        />
      </div>

      <ProviderMaxPriceSection providerForm={providerForm} setProviderForm={setProviderForm} />

      <p className="text-instrument text-meta">
        The{" "}
        <a
          href="https://openrouter.ai/docs/features/provider-routing"
          target="_blank"
          rel="noreferrer"
          className="text-accent-cyan underline decoration-dotted underline-offset-4"
        >
          provider routing guide
        </a>{" "}
        documents how these rules combine.
      </p>
    </div>
  );
};
