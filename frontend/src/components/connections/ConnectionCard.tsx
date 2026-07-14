"use client";

import { Check, Loader, Pencil, RefreshCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { ProviderIcon } from "@/components/connections/ProviderIcon";
import { ProviderKindBadges } from "@/components/connections/ProviderKindBadges";
import { Button } from "@/components/ui/button";
import { validateConnection } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

import type { ProviderConnection } from "@/lib/types";

interface ConnectionCardProps {
  connection: ProviderConnection;
  authToken: string;
  onEdit: (connection: ProviderConnection) => void;
  onRemove: (connection: ProviderConnection) => void;
  removing: boolean;
}

/**
 * One configured provider connection: label, provider type, capability
 * badges, non-secret config values, and validate/remove actions. Validation
 * state is card-local — probing one connection never touches the others.
 */
export function ConnectionCard({
  connection,
  authToken,
  onEdit,
  onRemove,
  removing,
}: ConnectionCardProps) {
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

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-hairline bg-canvas-raised text-primary">
            <ProviderIcon providerType={connection.provider_type} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">{connection.label}</p>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-meta">
              {connection.provider_type}
            </p>
            {baseUrl && <p className="mt-1 break-all text-[11px] text-meta">{baseUrl}</p>}
          </div>
        </div>
        <ProviderKindBadges kinds={connection.kinds} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleValidate}
          loading={checking}
          aria-label={`Validate ${connection.label}`}
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Validate
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onEdit(connection)}
          aria-label={`Edit ${connection.label}`}
        >
          <Pencil className="h-3.5 w-3.5" />
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
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </Button>
        {checking && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Loader className="h-3.5 w-3.5" />
            Checking…
          </span>
        )}
        {checkResult && !checking && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              checkResult.valid ? "text-data-pos" : "text-data-neg",
            )}
          >
            {checkResult.valid && <Check className="h-3.5 w-3.5" />}
            {checkResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
