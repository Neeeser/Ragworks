// API timestamp handling. Backend timestamps are UTC, but some serialize
// without a zone suffix ("2026-07-12T15:30:00"); parsing those with
// parseISO/new Date() reads them as *local* time and skews every displayed
// time by the viewer's UTC offset. All display formatting funnels through
// parseApiDate so offset-less strings are pinned to UTC once, here.

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/;

/** Parse an API timestamp, treating offset-less ISO strings as UTC. */
export function parseApiDate(dateLike: string | Date): Date {
  if (dateLike instanceof Date) {
    return dateLike;
  }
  const trimmed = dateLike.trim();
  return new Date(HAS_ZONE.test(trimmed) ? trimmed : `${trimmed}Z`);
}

/** The viewer's IANA timezone, falling back to US Eastern when unresolvable. */
export function resolvedTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) {
      return zone;
    }
  } catch {
    // Fall through to the fixed fallback.
  }
  return "America/New_York";
}

/** Absolute date+time in the viewer's timezone, e.g. "Jul 12, 2026, 3:30 PM". */
export function formatDateTime(dateLike?: string | Date | null): string {
  if (!dateLike) {
    return "—";
  }
  const date = parseApiDate(dateLike);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: resolvedTimeZone(),
  }).format(date);
}

/** Absolute date (no time) in the viewer's timezone, e.g. "Jul 12, 2026". */
export function formatDate(dateLike?: string | Date | null): string {
  if (!dateLike) {
    return "—";
  }
  const date = parseApiDate(dateLike);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: resolvedTimeZone(),
  }).format(date);
}
