"use client";

import { Pencil, RefreshCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { StatusDot } from "@/components/ui/status-dot";
import { validateConnection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

import type { StatusTone } from "@/components/ui/status-dot";
import type { ProviderConnection } from "@/lib/types";

interface ConnectionRowProps {
  connection: ProviderConnection;
  /** Human provider name from the type catalog (`openrouter` → `OpenRouter`). */
  providerLabel: string;
  authToken: string;
  onEdit: (connection: ProviderConnection) => void;
  onRemove: (connection: ProviderConnection) => void;
  removing: boolean;
  /**
   * Why this connection's last model listing failed, when it did. Read from the
   * catalog the pickers already load, so the page a "Manage connection" link
   * lands on states the same failure the picker showed rather than looking
   * healthy until the user thinks to press Validate.
   */
  syncError?: string | null;
}

/**
 * One configured provider connection as a row: derived validity dot, provider
 * mark and name, capability chips, and validate/edit/remove actions. Validation
 * state is row-local — probing one connection never touches the others — and
 * the row's dot reflects the live probe once it has run, falling back to the
 * stored `config_valid` flag. Secret config values are never rendered; the
 * backend redacts them out of `config` and only `secrets_configured` says a
 * secret exists at all.
 */
export function ConnectionRow({
  connection,
  providerLabel,
  authToken,
  onEdit,
  onRemove,
  removing,
  syncError,
}: ConnectionRowProps) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ valid: boolean; message: string } | null>(null);

  const handleValidate = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await validateConnection(authToken, connection.id);
      setCheckResult({
        valid: result.valid,
        message: result.message ?? (result.valid ? "Connected." : "Validation failed."),
      });
    } catch (error) {
      setCheckResult({
        valid: false,
        message: getErrorMessage(error, "Unable to validate this connection."),
      });
    } finally {
      setChecking(false);
    }
  };

  const baseUrl = connection.config.base_url;
  // A live probe the user just ran outranks the last background sync: they
  // pressed Validate to find out the current state, and reporting a stale
  // failure over their own successful check reads as the fix not working.
  const tone: StatusTone = checking
    ? "active"
    : checkResult
      ? checkResult.valid
        ? "pos"
        : "neg"
      : connection.config_valid === false || syncError
        ? "neg"
        : "pos";
  // Say the state in words wherever it isn't the uneventful one, so the dot
  // never carries meaning on colour alone.
  const stateLabel = checking
    ? "Checking"
    : checkResult
      ? checkResult.message
      : connection.config_valid === false
        ? "Stored config no longer validates."
        : syncError
          ? `Unreachable: ${syncError}`
          : null;

  // Container variants, not viewport ones: this row renders both on the wide
  // settings page and inside the setup wizard's ~576px step card. Keyed to the
  // viewport, the narrow card still laid the row out in one line, and the name
  // column — the only shrinkable cell next to the chips and three actions —
  // computed to zero width, hiding the label and breaking the base URL one
  // character per line.
  return (
    <div className="flex flex-col gap-2 border-b border-hairline px-3 py-2 last:border-b-0 @3xl:flex-row @3xl:items-center @3xl:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <StatusDot tone={tone} className="mt-1.5" />
        <ProviderIcon
          providerType={connection.provider_type}
          className="mt-0.5 h-4 w-4 shrink-0 text-muted"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-ui font-medium text-primary">{connection.label}</span>
            {/* Only when it says something the label doesn't: a connection named
                after its provider would otherwise print the same word twice. */}
            {providerLabel && providerLabel !== connection.label ? (
              <Chip dot={false}>{providerLabel}</Chip>
            ) : null}
          </div>
          {baseUrl ? (
            <p className="break-all font-mono text-instrument text-meta">{baseUrl}</p>
          ) : null}
          {stateLabel ? (
            <p
              className={cn(
                "text-instrument",
                tone === "neg"
                  ? "text-data-neg"
                  : tone === "active"
                    ? "text-accent-cyan"
                    : "text-data-pos",
              )}
            >
              {stateLabel}
            </p>
          ) : null}
        </div>
      </div>
      <div className="shrink-0">
        <ProviderKindBadges kinds={connection.kinds} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleValidate}
          loading={checking}
          aria-label={`Validate ${connection.label}`}
        >
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
          Validate
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onEdit(connection)}
          aria-label={`Edit ${connection.label}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRemove(connection)}
          loading={removing}
          aria-label={`Remove ${connection.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove
        </Button>
      </div>
    </div>
  );
}
