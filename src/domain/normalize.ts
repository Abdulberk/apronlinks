/**
 * Normalization exists because a false alert is worse than a missed one.
 *
 * Operations teams go blind to noisy dashboards. If a provider changes how it
 * formats a tail code one day, a system comparing raw strings fires a false
 * alert for the entire fleet, and a real aircraft swap becomes invisible inside
 * that noise. So this is a correctness requirement for the human reading the
 * screen, not a cosmetic nicety.
 *
 * The rule: STORE what the provider said, COMPARE normalized. The normalized
 * form is never persisted — a stored derived value is a cache, and a cache
 * without invalidation drifts away from its source.
 */

/** `nq-atc ` and `NQ-ATC` are the same aircraft. */
export function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * `TK 0234`, `TK0234` and `TK234` are the same flight.
 *
 * The alternation is spelled out rather than written as `[A-Z0-9]{2,3}`. That
 * shorter form is greedy AND matches digits, so on `TK0234` it captures `TK0`,
 * leaves `234`, and the overall match still succeeds — which means the engine
 * never backtracks to the two-character branch. The padding zero disappears
 * into the airline code and `TK0234` normalizes to itself. Three-letter ICAO
 * designators such as `ALX314` hide the bug completely, which is exactly why it
 * survives casual testing.
 *
 * Anything that is not `<designator><digits>` passes through uppercased:
 * `THY5LK` is a callsign, not a flight number, and mangling it would be worse
 * than leaving it alone.
 */
export function normalizeFlightNumber(value: string): string {
  const compact = value.toUpperCase().replace(/\s/g, '');
  const match = compact.match(/^([A-Z]{3}|[A-Z0-9]{2})0*(\d{1,4})$/);
  return match ? `${match[1]}${match[2]}` : compact;
}

/**
 * Providers send whitespace where they mean "unknown". Treating blank as a
 * value would let it overwrite a real one.
 */
export function blankToNull(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() === '' ? null : value;
}

/**
 * Written when a provider gives us a flight without a number. The column is NOT
 * NULL because a flight without any identifier is not useful, but the value is
 * an admission of absence rather than a value — so change detection has to
 * treat it as absent, or the first snapshot that fills it in raises
 * "Flight number changed from UNKNOWN to ALX314", which is precisely the kind
 * of meaningless alert this file exists to prevent.
 */
export const UNKNOWN_FLIGHT_NUMBER = 'UNKNOWN';
