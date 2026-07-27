"use client";

import { useId, useState } from "react";

import {
  CAPABILITY_IMPLIES,
  CAPABILITY_OPTIONS,
  expandCapabilities,
  impliedCapabilities,
  serverNameFor,
} from "@/components/mcp/lib/connection";
import { McpConnectionInstructions } from "@/components/mcp/McpConnectionInstructions";
import { Button } from "@/components/ui/button";
import { CheckboxBox } from "@/components/ui/checkbox";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

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

  // Capabilities the current selection grants on its own: shown checked and
  // locked, so the picker cannot express a narrower key than will be issued.
  const impliedBy = impliedCapabilities(capabilities);

  const impliedNote = (capability: ApiKeyCapability): string => {
    const sources = CAPABILITY_OPTIONS.filter(
      (option) =>
        capabilities.includes(option.value) &&
        (CAPABILITY_IMPLIES[option.value] ?? []).includes(capability),
    ).map((option) => option.label);
    return `Included with ${sources.join(" and ")}.`;
  };

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
    onClose();
  };

  const submit = async () => {
    const result = await onCreate({
      name: name.trim() || `${collection.name} agent`,
      capabilities: expandCapabilities(capabilities),
      collection_ids: [collection.id],
    });
    if (result) {
      setCreated(result);
      setSecret(result.secret);
    }
  };

  return (
    <ModalOverlay open={open} onClose={close} labelledBy={titleId}>
      <div className="card-surface w-full max-w-2xl bg-canvas-raised p-4 text-primary shadow-elevation-2">
        <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
          {created ? "Connect your agent" : "Create an MCP key"}
        </h2>

        {created && secret ? (
          <div className="mt-4">
            <McpConnectionInstructions
              serverName={serverNameFor(collection.name)}
              endpoint={endpoint}
              secret={secret}
            />
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <Field label="Name">
              <TextInput
                autoFocus
                value={name}
                placeholder={`${collection.name} agent`}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <fieldset>
              <legend className="text-instrument font-medium text-muted">Permissions</legend>
              <div className="mt-2 space-y-2">
                {CAPABILITY_OPTIONS.map((option) => {
                  const implied = impliedBy.has(option.value);
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "flex items-start gap-3 rounded-control border border-hairline bg-surface p-3 transition-colors duration-80 ease-standard",
                        implied ? "cursor-default" : "cursor-pointer hover:border-strong",
                      )}
                    >
                      <CheckboxBox
                        className="mt-0.5"
                        checked={implied || capabilities.includes(option.value)}
                        disabled={implied}
                        onChange={() => toggle(option.value)}
                      />
                      <span>
                        <span className="block text-ui font-medium text-primary">
                          {option.label}
                        </span>
                        <span className="block text-instrument text-muted">
                          {implied ? impliedNote(option.value) : option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {error && <p className="text-ui text-data-neg">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
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
      </div>
    </ModalOverlay>
  );
}
