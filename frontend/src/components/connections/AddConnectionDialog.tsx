"use client";

import { useId } from "react";

import { ConnectionConfigFields } from "@/components/connections/ConnectionConfigFields";
import { useAddConnection } from "@/components/connections/hooks/use-add-connection";
import { toProviderChoices } from "@/components/connections/lib/provider-choices";
import { ProviderChoiceCard } from "@/components/connections/ProviderChoiceCard";
import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

import type { ProviderConnection, ProviderTypeInfo } from "@/lib/types";

interface AddConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  authToken: string;
  providerTypes: ProviderTypeInfo[];
  existingConnections: ProviderConnection[];
  onCreated: (connection: ProviderConnection) => void;
}

/**
 * True when a type is discoverable: it is addressed by URL and declares its
 * capabilities as toggles. Derived from the field catalog rather than a
 * provider-type check, so a future type that works the same way gets the
 * detect step without a change here.
 */
function supportsDetection(type: ProviderTypeInfo): boolean {
  const names = new Set(type.config_fields.map((field) => field.name));
  return names.has("base_url") && type.config_fields.some((field) => field.kind === "boolean");
}

/** Indefinite article for a provider name, by its first sound's spelling. */
const articleFor = (label: string) =>
  "aeiou".includes(label.charAt(0).toLowerCase()) ? "an" : "a";

/** The link text a provider's docs deserve — what the user has to fetch, not "documentation". */
function docsLinkLabel(type: ProviderTypeInfo): string {
  if (type.provider_type === "ollama") return "Get Ollama";
  const needsKey = type.config_fields.some((field) => field.kind === "secret" && field.required);
  return needsKey
    ? `Get ${articleFor(type.label)} ${type.label} API key`
    : "Provider documentation";
}

/**
 * The generic add-connection flow: pick a provider from the mark grid, then
 * fill a form rendered from that type's `config_fields` catalog — a new
 * provider type needs zero new form code here. The dialog frame keeps one size
 * across both steps so switching never reflows the overlay; the pre-save probe
 * runs against `/api/connections/validate`.
 */
export function AddConnectionDialog({
  open,
  onClose,
  authToken,
  providerTypes,
  existingConnections,
  onCreated,
}: AddConnectionDialogProps) {
  const titleId = useId();
  const flow = useAddConnection({ authToken, onCreated, onClose });
  const { selectedType, config, error, probeMessage, unreachable, busy, missingRequired } = flow;
  const providerChoices = toProviderChoices(providerTypes, existingConnections);

  if (!open) return null;

  return (
    <ModalOverlay open={open} onClose={flow.close} labelledBy={titleId}>
      {/* One fixed frame for both steps so picking a provider never resizes the dialog. */}
      <div className="card-surface flex h-[36rem] max-h-[85vh] w-full max-w-xl flex-col bg-canvas-raised shadow-elevation-2">
        <div className="flex items-center gap-3 border-b border-hairline p-3">
          {selectedType ? (
            <ProviderIcon
              providerType={selectedType.provider_type}
              className="h-5 w-5 shrink-0 text-muted"
            />
          ) : null}
          <h2 id={titleId} className="text-head font-semibold tracking-[-0.01em] text-primary">
            {selectedType ? `Connect ${selectedType.label}` : "Add a provider"}
          </h2>
        </div>
        {!selectedType ? (
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3">
            {providerChoices.map((choice) => (
              <ProviderChoiceCard
                key={choice.type.provider_type}
                choice={choice}
                onPick={() => flow.pickType(choice.type)}
              />
            ))}
            {providerChoices.length === 0 ? (
              <div className="col-span-2 p-8 text-center">
                <p className="text-ui text-muted">No provider types are available.</p>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ProviderKindBadges kinds={selectedType.kinds} />
                {selectedType.docs_url ? (
                  <a
                    href={selectedType.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-control text-instrument text-accent-cyan underline-offset-2 transition-colors duration-80 ease-standard hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  >
                    {docsLinkLabel(selectedType)}
                  </a>
                ) : null}
              </div>
              <Field label="Label" hint="A name for this connection (e.g. Homelab Ollama).">
                <TextInput
                  value={flow.label}
                  onChange={(event) => flow.setLabel(event.target.value)}
                />
              </Field>
              <ConnectionConfigFields
                fields={selectedType.config_fields}
                config={config}
                onChange={flow.setField}
              />
            </div>
            {/* The probe result sits outside the scrolling body, next to the
                Test button that produced it: at the bottom of a long form it
                landed below the fold, so a connection read as having done
                nothing until the user scrolled. Test and Add both clear both
                channels first, so only one is ever set. */}
            {error || probeMessage ? (
              <p
                className={cn(
                  "border-t border-hairline px-3 py-2 text-ui",
                  error ? "text-data-neg" : "text-data-pos",
                )}
                role="status"
              >
                {error ?? probeMessage}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2 border-t border-hairline p-3">
              <Button type="button" variant="ghost" onClick={flow.clearType}>
                Back
              </Button>
              <div className="flex items-center gap-2">
                {supportsDetection(selectedType) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={flow.detect}
                    loading={busy.detecting}
                    disabled={!(config.base_url ?? "").trim() || busy.submitting || busy.probing}
                  >
                    Detect
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={flow.test}
                  loading={busy.probing}
                  disabled={missingRequired || busy.submitting || busy.detecting}
                >
                  Test
                </Button>
                <Button
                  type="button"
                  onClick={flow.create}
                  loading={busy.submitting}
                  disabled={missingRequired || busy.probing || busy.detecting}
                >
                  {unreachable ? "Add anyway" : "Add connection"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  );
}
