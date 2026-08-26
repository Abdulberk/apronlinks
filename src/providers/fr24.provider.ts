import { Injectable, Logger } from '@nestjs/common';
import type { FlightSnapshot } from '../domain';
import { env } from '../config/env';
import { parseBatch } from './fr24.parser';
import {
  RetryableProviderError,
  UnrecoverableProviderError,
  classifyStatus,
  type FlightDataProvider,
} from './provider.interface';

/**
 * Flightradar24 adapter.
 *
 * Two things about this provider shape the whole design and are worth stating
 * where the code lives rather than only in a README.
 *
 * It publishes no schedules — "we do not provide flight scheduling information
 * via our API" — so scheduledDeparture stays null for anything sourced here and
 * the schedule-relative polling tiers are unreachable. Cadence falls back to
 * status.
 *
 * A flight does not exist in its API until the aircraft is transmitting. There
 * is nothing to poll before departure, which is why acquisition is a separate
 * concern: flights are found by route, registration or area, and only then
 * followed by the fr24_id that search returned. Following by flight number
 * would break at the exact moment a flight number changes, which is one of the
 * two things this service exists to notice.
 */
@Injectable()
export class Fr24Provider implements FlightDataProvider {
  readonly name = 'fr24' as const;
  readonly maxIdsPerQuery: number;

  private readonly logger = new Logger(Fr24Provider.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor() {
    const config = env();
    this.baseUrl = config.FR24_BASE_URL;
    this.apiKey = config.FR24_API_KEY ?? '';
    this.timeoutMs = config.PROVIDER_TIMEOUT_MS;
    // Their OpenAPI document says 15 and their prose documentation says 10.
    // Take the lower: exceeding the real cap returns a billable 4xx that no
    // amount of retrying turns into data.
    this.maxIdsPerQuery = config.FR24_MAX_IDS_PER_QUERY;
  }

  async fetchSnapshots(providerFlightIds: string[]): Promise<FlightSnapshot[]> {
    if (providerFlightIds.length === 0) return [];

    // flight-summary is the only endpoint that accepts flight ids. The live
    // position endpoints filter by area, callsign or registration and cannot be
    // asked about a specific flight at all.
    const url = new URL('/api/flight-summary/full', this.baseUrl);
    url.searchParams.set('flight_ids', providerFlightIds.join(','));

    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          // Omitting this returns 400, not a default version.
          'Accept-Version': 'v1',
        },
        // Nothing else in the stack imposes a deadline: undici waits five
        // minutes by default. A circuit breaker cannot protect against latency
        // it never observes, because a request that never returns never counts
        // as a failure.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new RetryableProviderError(
        `flight-summary request failed: ${String(error)}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      if (classifyStatus(response.status) === 'permanent') {
        // 402 is "credit limit reached" and is documented on almost every one
        // of their endpoints. Retrying it burns four more billable attempts to
        // arrive at the same answer.
        throw new UnrecoverableProviderError(
          response.status,
          `flight-summary ${response.status}: ${detail.slice(0, 200)}`,
        );
      }

      const retryAfter = response.headers.get('retry-after');
      throw new RetryableProviderError(
        `flight-summary ${response.status}`,
        retryAfter ? Number(retryAfter) * 1000 : undefined,
      );
    }

    const { snapshots, rejected } = parseBatch(
      await response.json(),
      new Date(),
    );

    if (rejected > 0) {
      this.logger.warn(
        `${rejected} of ${providerFlightIds.length} records failed to parse`,
      );
    }

    return snapshots;
  }
}
