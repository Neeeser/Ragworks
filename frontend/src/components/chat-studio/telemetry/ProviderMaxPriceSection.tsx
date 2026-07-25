"use client";

import { Field, TextInput } from "@/components/ui/field";
import { InstrumentLabel } from "@/components/ui/instrument-label";

import type { ProviderFormState } from "@/components/chat-studio/lib/types";

type ProviderMaxPriceSectionProps = {
  providerForm: ProviderFormState;
  setProviderForm: (updater: (prev: ProviderFormState) => ProviderFormState) => void;
};

const PRICE_FIELDS = [
  { key: "maxPrompt", label: "Prompt", placeholder: "1.00" },
  { key: "maxCompletion", label: "Completion", placeholder: "2.00" },
  { key: "maxRequest", label: "Request", placeholder: "0.25" },
  { key: "maxImage", label: "Image", placeholder: "0.02" },
] as const;

/** Per-turn price caps (prompt/completion/request/image). Split out of
 *  ProviderRoutingCard to keep that file under the module-size limit. */
export const ProviderMaxPriceSection = ({
  providerForm,
  setProviderForm,
}: ProviderMaxPriceSectionProps) => (
  <div className="space-y-2 border-t border-hairline pt-3">
    <InstrumentLabel>Max price ($/M tokens)</InstrumentLabel>
    <div className="grid grid-cols-2 gap-2">
      {PRICE_FIELDS.map((field) => (
        <Field key={field.key} label={field.label}>
          <TextInput
            type="number"
            min="0"
            step="0.0001"
            placeholder={field.placeholder}
            value={providerForm[field.key]}
            onChange={(event) =>
              setProviderForm((prev) => ({ ...prev, [field.key]: event.target.value }))
            }
          />
        </Field>
      ))}
    </div>
  </div>
);
