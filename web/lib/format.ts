/** Presentation helpers. No business rules live here. */

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));

  if (seconds < 45) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/**
 * Departure times render in UTC with the Z shown.
 *
 * Aviation runs on UTC precisely so that nobody has to reason about whose
 * local time a number is in, and silently converting to the viewer's zone
 * would reintroduce the ambiguity the industry standardised away.
 */
export function utcClock(iso: string | null): string {
  if (iso === null) return '—';
  return `${iso.slice(11, 16)}Z`;
}

export function utcDay(iso: string | null): string {
  if (iso === null) return '—';
  return iso.slice(0, 10);
}

export function route(origin: string | null, destination: string | null): string {
  return `${origin ?? '????'} → ${destination ?? '????'}`;
}

/** The last segment of a UUIDv7 — the random part, so rows differ from each other. */
export function shortId(id: string): string {
  return id.slice(-8);
}
