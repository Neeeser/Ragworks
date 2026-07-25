"use client";

import { useId, useState } from "react";

import { CAPABILITY_OPTIONS, serverNameFor } from "@/components/mcp/lib/connection";
import { McpConnectionInstructions } from "@/components/mcp/McpConnectionInstructions";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { GlassCard } from "@/components/ui/panel";

import type { ApiKeyCapability, ApiKeyCreated, ApiKeyCreatePayload } from "@/lib/types/api-keys";
import type { Collection } from "@/lib/types/collections";

type ConnectAgentDialogProps = {
  open: boolean;
  collection: Collection;
  /** The collection's MCP endpoint URL, resolved by the caller after mount. */
  endpoint: string;
  busy: boolean;
  error: string | null;
  onCreate: (payload: ApiKeyCreatePayload) => Promise<ApiKeyCreated | null>;
  onClose: () => void;
};

const labelClass = "font-mono text-[11px] uppercase tracking-[0.28em] text-muted";

/**
 * Issue a key for one collection's MCP endpoint and show how to connect.
 *
 * Capabilities are chosen per key: what the agent may do is decided here, and
 * the endpoint only ever exposes the tools the choice covers.
 */
export function ConnectAgentDialog({
  open,
  collection,
  endpoint,
  busy,
  error,
  onCreate,
  onClose,
}: ConnectAgentDialogProps) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<ApiKeyCapability[]>(["tools:invoke"]);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [allCollections, setAllCollections] = useState(false);

  const toggle = (capability: ApiKeyCapability) => {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
  };

  const close = () => {
    setCreated(null);
    setSecret(null);
    setName("");
    setCapabilities(["tools:invoke"]);
    setAllCollections(false);
    onClose();
  };

  const submit = async () => {
    const result = await onCreate({
      name: name.trim() || `${collection.name} agent`,
      capabilities,
      all_collections: allCollections,
      collection_ids: allCollections ? [] : [collection.id],
    });
    if (result) {
      setCreated(result);
      setSecret(result.secret);
    }
  };

  return (
    <ModalOverlay open={open} onClose={close} labelledBy={titleId}>
      <GlassCard className="w-full max-w-2xl rounded-3xl p-6">
        <h2 id={titleId} className="text-xl font-semibold tracking-tight text-primary">
          {created ? "Connect your agent" : "Create an MCP key"}
        </h2>

        {created && secret ? (
          <div className="mt-5">
            <McpConnectionInstructions
              serverName={serverNameFor(collection.name)}
              endpoint={endpoint}
              secret={secret}
            />
            <div className="mt-6 flex justify-end">
              <Button type="button" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <Field label="Name" labelClassName={labelClass}>
              <TextInput
                autoFocus
                value={name}
                placeholder={`${collection.name} agent`}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <fieldset>
              <legend className={labelClass}>Permissions</legend>
              <div className="mt-2 space-y-2">
                {CAPABILITY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hairline bg-surface p-3 transition hover:border-strong"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-accent-violet"
                      checked={capabilities.includes(option.value)}
                      onChange={() => toggle(option.value)}
                    />
                    <span>
                      <span className="block text-sm text-primary">{option.label}</span>
                      <span className="block text-xs text-muted">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className={labelClass}>Reach</legend>
              <p className="mt-2 text-xs text-muted leading-relaxed">
                This endpoint only ever serves {collection.name}. Reach decides which other
                collections&apos; endpoints the same key may be used on.
              </p>
              <div className="mt-2 space-y-2">
                {[
                  {
                    all: false,
                    label: collection.name,
                    description: "This collection's endpoint only.",
                  },
                  {
                    all: true,
                    label: "Every collection",
                    description: "Also every collection created later.",
                  },
                ].map((option) => (
                  <label
                    key={String(option.all)}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-hairline bg-surface p-3 transition hover:border-strong"
                  >
                    <input
                      type="radio"
                      name="scope"
                      className="mt-1 h-4 w-4 accent-accent-violet"
                      checked={allCollections === option.all}
                      onChange={() => setAllCollections(option.all)}
                    />
                    <span>
                      <span className="block text-sm text-primary">{option.label}</span>
                      <span className="block text-xs text-muted">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error && <p className="text-sm text-data-neg">{error}</p>}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                loading={busy}
                disabled={capabilities.length === 0}
                onClick={() => void submit()}
              >
                Create key
              </Button>
            </div>
          </div>
        )}
      </GlassCard>
    </ModalOverlay>
  );
}
