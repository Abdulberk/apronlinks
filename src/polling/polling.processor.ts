import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';
import { nextPollDelay } from '../domain';
import {
  FLIGHT_DATA_PROVIDER,
  UnrecoverableProviderError,
  type FlightDataProvider,
} from '../providers/provider.interface';

export const POLL_QUEUE = 'flight-sweep';

/** How many flights one sweep will consider. Bounds the work per tick. */
const SWEEP_LIMIT = 200;

/**
 * A single repeating sweep rather than a chain of self-scheduling jobs.
 *
 * The chain is the tempting design — each poll books its own successor — and it
 * has a failure mode that only shows up in production: a job that exhausts its
 * retries never books the next one, so that flight silently stops being polled
 * forever, and the only symptom is a lastSyncedAt quietly getting older. There
 * is no error, no dead letter, no gap in a queue anyone is watching.
 *
 * A sweep cannot do that. The schedule belongs to the queue and the due list
 * belongs to Postgres, so a processor throwing loses one tick rather than one
 * flight. It also means the batching that the provider interface exists for
 * actually gets used: a chain fetches one flight at a time, which makes the
 * array parameter a lie.
 */
@Processor(POLL_QUEUE, { concurrency: 1 })
export class PollingProcessor extends WorkerHost {
  private readonly logger = new Logger(PollingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
    @Inject(FLIGHT_DATA_PROVIDER)
    private readonly provider: FlightDataProvider,
  ) {
    super();
  }

  async process(): Promise<{ polled: number; applied: number }> {
    const now = new Date();

    const due = await this.prisma.flight.findMany({
      where: {
        trackingActive: true,
        OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
      },
      orderBy: { nextPollAt: 'asc' },
      take: SWEEP_LIMIT,
    });

    if (due.length === 0) return { polled: 0, applied: 0 };

    let applied = 0;

    for (const batch of chunk(due, this.provider.maxIdsPerQuery)) {
      const ids = batch.map((f) => f.providerFlightId);

      let snapshots;
      try {
        snapshots = await this.provider.fetchSnapshots(ids);
      } catch (error) {
        if (error instanceof UnrecoverableProviderError) {
          // Asking again will fail the same way and be billed again, so record
          // it against the flights and move on rather than retrying into it.
          this.logger.error(`provider refused the batch: ${error.message}`);
          await this.markAttempted(
            batch.map((f) => f.id),
            now,
            error.message,
          );
          continue;
        }
        throw error;
      }

      for (const snapshot of snapshots) {
        const result = await this.ingest.process(snapshot);
        if (result.outcome === 'APPLIED') applied += 1;
      }

      await this.scheduleNext(batch, now);
    }

    return { polled: due.length, applied };
  }

  /**
   * Cadence comes from the pure domain function, so when the next look happens
   * is decided by the same tested code whether the trigger was a sweep, a
   * backfill or a test.
   */
  private async scheduleNext(
    flights: {
      id: string;
      status: string;
      scheduledDeparture: Date | null;
      arrivedAt: Date | null;
    }[],
    now: Date,
  ): Promise<void> {
    for (const flight of flights) {
      const delay = nextPollDelay(
        {
          status: flight.status as never,
          scheduledDeparture: flight.scheduledDeparture,
          arrivedAt: flight.arrivedAt,
        },
        now,
      );

      await this.prisma.flight.update({
        where: { id: flight.id },
        data:
          delay === null
            ? { trackingActive: false, nextPollAt: null, lastPolledAt: now }
            : { nextPollAt: new Date(+now + delay), lastPolledAt: now },
      });
    }
  }

  /** Records that we tried, so a failing flight ages out of the due list. */
  private async markAttempted(
    ids: string[],
    now: Date,
    reason: string,
  ): Promise<void> {
    await this.prisma.flight.updateMany({
      where: { id: { in: ids } },
      data: {
        lastPolledAt: now,
        nextPollAt: new Date(+now + 5 * 60_000),
        lastError: reason.slice(0, 500),
      },
    });
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
