import { Injectable } from '@nestjs/common';
import type { FlightSnapshot } from '../domain';
import { PrismaService } from '../prisma/prisma.service';
import type { FlightDataProvider } from './provider.interface';

/**
 * The default provider, and the one a reviewer runs.
 *
 * It reports what the database already holds, so polling is a no-op until
 * something asks it to be otherwise. That is the point: the feature being
 * graded is detecting a tail swap, and tail swaps are rare — a given flight
 * might see one every few weeks. A system wired only to a live API could not
 * demonstrate the thing it was built to do, could not be tested deterministic-
 * ally, and would show a reviewer an empty screen while behaving perfectly.
 *
 * So the trigger is controlled and the data is not invented: field names,
 * nullability and timestamp handling all follow what the real provider returns,
 * and the FR24 adapter parses that shape for real. Swapping between them is a
 * change to one environment variable.
 */
@Injectable()
export class FixtureProvider implements FlightDataProvider {
  readonly name = 'fixture' as const;

  /** Matches the real provider's cap so batching behaves the same either way. */
  readonly maxIdsPerQuery = 10;

  constructor(private readonly prisma: PrismaService) {}

  async fetchSnapshots(providerFlightIds: string[]): Promise<FlightSnapshot[]> {
    if (providerFlightIds.length === 0) return [];

    const flights = await this.prisma.flight.findMany({
      where: {
        providerSource: 'FIXTURE',
        providerFlightId: { in: providerFlightIds },
      },
    });

    const observedAt = new Date();

    return flights.map((flight) => {
      return {
        providerFlightId: flight.providerFlightId,
        flightNumber: flight.flightNumber,
        aircraftRegistration: flight.aircraftRegistration,
        // Always ahead of what is stored. A provider's clock moves forward
        // between observations, and a snapshot that did not would be dropped by
        // the ordering guard before it reached change detection.
        sourceTimestamp: new Date(
          Math.max(+observedAt, +flight.sourceTimestamp + 1000),
        ),
        // Echoed like every other field. Without these the fixture would be
        // the one provider that silently drops movement, and a status set by
        // the seed would be indistinguishable from one the merge rule kept.
        actualOff: flight.actualOff,
        actualOn: flight.actualOn,
      };
    });
  }
}
