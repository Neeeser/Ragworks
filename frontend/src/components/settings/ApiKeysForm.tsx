import { Cloud, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import type { FormEvent } from "react";

export type KeyBadge = { label: string; className: string };

type ApiKeysFormProps = {
  openrouterValue: string;
  pineconeValue: string;
  onChangeOpenrouter: (value: string) => void;
  onChangePinecone: (value: string) => void;
  openrouterBadge: KeyBadge;
  pineconeBadge: KeyBadge;
  openrouterConfigured: boolean;
  pineconeConfigured: boolean;
  openrouterPlaceholder: string;
  pineconePlaceholder: string;
  pendingClearOpenrouter: boolean;
  pendingClearPinecone: boolean;
  onRemoveOpenrouter: () => void;
  onRemovePinecone: () => void;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/** The "OpenRouter / Pinecone API key" form: one Field per provider, each with a
 * status badge and a "Remove" affordance to clear a previously saved key on submit. */
export function ApiKeysForm({
  openrouterValue,
  pineconeValue,
  onChangeOpenrouter,
  onChangePinecone,
  openrouterBadge,
  pineconeBadge,
  openrouterConfigured,
  pineconeConfigured,
  openrouterPlaceholder,
  pineconePlaceholder,
  pendingClearOpenrouter,
  pendingClearPinecone,
  onRemoveOpenrouter,
  onRemovePinecone,
  saving,
  onSubmit,
}: ApiKeysFormProps) {
  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      <div>
        <Field
          label={
            <>
              <KeyRound className="h-4 w-4 text-violet-300" />
              OpenRouter API key
            </>
          }
          labelClassName="flex items-center gap-2 text-sm text-white"
          labelEnd={
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] uppercase tracking-[0.2em]",
                  openrouterBadge.className,
                )}
              >
                {openrouterBadge.label}
              </span>
              {openrouterConfigured && (
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300 transition hover:border-white/30 hover:text-white"
                  onClick={onRemoveOpenrouter}
                >
                  Remove
                </button>
              )}
            </div>
          }
          hint="Used for embeddings, chat, and provider metadata."
        >
          <TextInput
            type="password"
            autoComplete="off"
            placeholder={openrouterPlaceholder}
            value={openrouterValue}
            onChange={(event) => onChangeOpenrouter(event.target.value)}
          />
        </Field>
        {pendingClearOpenrouter && (
          <p className="mt-2 text-xs text-amber-300">Will remove on save.</p>
        )}
      </div>

      <div>
        <Field
          label={
            <>
              <Cloud className="h-4 w-4 text-cyan-300" />
              Pinecone API key
              <span className="text-xs font-normal normal-case tracking-normal text-slate-400">
                (optional — only for Pinecone-backed pipelines; pgvector needs no key)
              </span>
            </>
          }
          labelClassName="flex items-center gap-2 text-sm text-white"
          labelEnd={
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] uppercase tracking-[0.2em]",
                  pineconeBadge.className,
                )}
              >
                {pineconeBadge.label}
              </span>
              {pineconeConfigured && (
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300 transition hover:border-white/30 hover:text-white"
                  onClick={onRemovePinecone}
                >
                  Remove
                </button>
              )}
            </div>
          }
          hint="Powers vector indexing, retrieval, and namespace cleanup."
        >
          <TextInput
            type="password"
            autoComplete="off"
            placeholder={pineconePlaceholder}
            value={pineconeValue}
            onChange={(event) => onChangePinecone(event.target.value)}
          />
        </Field>
        {pendingClearPinecone && (
          <p className="mt-2 text-xs text-amber-300">Will remove on save.</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving}>
          Save settings
        </Button>
        <p className="text-xs text-slate-400">
          Leave fields blank to keep existing keys. Use Remove to clear a provider.
        </p>
      </div>
    </form>
  );
}
