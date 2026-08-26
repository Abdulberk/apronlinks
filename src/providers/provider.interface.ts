import type { FlightSnapshot } from '../domain';

/**
 * What the service needs from a flight-data provider, and nothing more.
 *
 * The interface is this thin on purpose. Two providers were studied closely
 * enough to know what a wider one would cost: Flightradar24 authenticates with
 * a bearer token plus a version header and only polls, while FlightAware
 * authenticates with x-apikey, publishes schedules and can push. Trying to
 * express both surfaces here would produce an abstraction shaped like neither.
 *
 * There is deliberately no usage() method. FR24 reports credits over a window
 * enum with no currency, FlightAware reports dollars on a 10-20 minute lag, and
 * a single signature covering both would be a lie in one direction or the
 * other.
 */
export interface FlightDataProvider {
  readonly name: 'fixture' | 'fr24';

  /**
   * How many flights one request may ask about. Callers chunk by this.
   *
   * Worth being precise about what it buys: FR24 bills per returned entity, so
   * one request returning ten costs the same as two returning five. This is a
   * rate-limit control, not a cost control.
   */
  readonly maxIdsPerQuery: number;

  fetchSnapshots(providerFlightIds: string[]): Promise<FlightSnapshot[]>;
}

export const FLIGHT_DATA_PROVIDER = Symbol('FLIGHT_DATA_PROVIDER');

/**
 * A provider failure that retrying cannot fix. A bad key, an exhausted credit
 * balance or a malformed request will fail identically on the fifth attempt as
 * on the first — and with these providers each of those attempts is billed, so
 * backing off and trying again spends money to learn nothing.
 */
export class UnrecoverableProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UnrecoverableProviderError';
  }
}

/** Worth another attempt: a timeout, a rate limit, a network blip, a 5xx. */
export class RetryableProviderError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RetryableProviderError';
  }
}

/**
 * Decides which of the two a response is.
 *
 * The default runs the opposite way round from the obvious one. Anything in the
 * 4xx range other than 408 and 429 is treated as permanent, because it means we
 * asked wrongly and asking again identically will fail identically. Only
 * timeouts, rate limits and server-side faults are worth repeating.
 */
export function classifyStatus(status: number): 'retryable' | 'permanent' {
  if (status === 408 || status === 429) return 'retryable';
  if (status >= 500) return 'retryable';
  if (status >= 400) return 'permanent';
  return 'retryable';
}
