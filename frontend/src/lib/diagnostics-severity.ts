/**
 * Shared severity vocabulary for diagnostics and search-failure UI.
 *
 * One source of truth mapping a `DiagnosticSeverity` to the `IngestionBadge`
 * token triad (amber/rose/green with TriangleAlert/X/Check) and the
 * `border-X/30 bg-X/10 text-X` alert-box recipe, so the diagnostics list and
 * the search-failure panel stay in visual parity without copy-paste.
 */
import { Check, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";

import type { DiagnosticSeverity } from "@/lib/types";

export interface SeverityStyle {
  /** lucide icon for the severity. */
  icon: LucideIcon;
  /** Circular icon-chip classes (matches IngestionBadge). */
  chipClass: string;
  /** Alert-box classes (border + tint + text). */
  boxClass: string;
  /** Accessible label. */
  label: string;
}

const STYLES: Record<DiagnosticSeverity, SeverityStyle> = {
  error: {
    icon: X,
    chipClass: "bg-data-neg/15 text-data-neg",
    boxClass: "border-data-neg/30 bg-data-neg/10 text-data-neg",
    label: "Error",
  },
  warning: {
    icon: TriangleAlert,
    chipClass: "bg-data-warn/15 text-data-warn",
    boxClass: "border-data-warn/30 bg-data-warn/10 text-data-warn",
    label: "Warning",
  },
  info: {
    icon: Info,
    chipClass: "bg-surface-strong text-accent-cyan",
    boxClass: "border-hairline bg-surface/60 text-muted",
    label: "Info",
  },
};

/** Return the shared style tokens for a diagnostic severity. */
export function severityStyle(severity: DiagnosticSeverity): SeverityStyle {
  return STYLES[severity];
}

/** The clean/consistent state reuses the positive (green) token. */
export const CONSISTENT_STYLE: SeverityStyle = {
  icon: Check,
  chipClass: "bg-data-pos/15 text-data-pos",
  boxClass: "border-data-pos/30 bg-data-pos/10 text-data-pos",
  label: "Consistent",
};
