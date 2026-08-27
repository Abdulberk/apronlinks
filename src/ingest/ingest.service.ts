import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AlertStream } from '../alerts/alert-stream';
import { UNKNOWN_FLIGHT_NUMBER, detectChanges, formatAlert } from '../domain';
import type { FlightSnapshot } from '../domain';
import type {
  IngestOutcome,
  Prisma,
  Provider,
} from '../generated/prisma/client';
import { ConcurrencyError, isUniqueViolation } from './errors';
import { env } from '../config/env';

/**
 * How many times a lost race is worth re-reading and retrying.
 *
 * This has to exceed the expected contention depth, not be a round number. N
 * writers on one row serialize on Postgres's row lock, so in the worst
 * interleaving exactly one wins per round and the unluckiest needs N rounds. A
 * budget of 4 against the 5-writer case in the test suite is a latent flake:
 * it passes on an idle machine and fails on a loaded CI runner.
 */
const MAX_ATTEMPTS = 12;

/**
 * Without a ceiling, 20 * 2^11 is about 41 seconds — longer than the test
 * timeout, which would trade a contention flake for a timeout flake.
 */
const BACKOFF_CEILING_MS = 250;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface IngestResult {
  outcome: IngestOutcome;
  flightId: string | null;
  changes: number;
  alerts: number;
}

/**
 * The single funnel every piece of flight data passes through, whichever way it
 * arrived: a scheduled poll, a signed webhook, or the demo trigger.
 *
 * Duplicate processing is stopped in three independent places, and it is worth
 * being precise about which does what because they are often conflated:
 *
 *   L1 replay guard    a delivery id already recorded means this exact delivery
 *                      has been handled. Only the signed endpoint carries one.
 *   L2 content guard   detectChanges finds no difference, so there is nothing
 *                      to record regardless of how many times it arrives.
 *   L3 concurrency     the compare-and-swap on Flight.revision admits exactly
 *                      one writer per state transition, and the unique index on
 *                      (flightId, field, fromRevision) makes that unviolatable
 *                      even if the lock is later got wrong.
 *
 * The poll path deliberately has no replay guard and does not need one. FR24
 * issues no delivery id, and its payload timestamp changes on every call —
 * measured: three consecutive requests for identical static data produced three
 * different payload hashes — so hashing there would never deduplicate anything
 * while still writing a row per poll. L2 and L3 already cover it: a redelivery
 * arriving after the first one committed simply finds no diff.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  /**
   * Which provider issued the ids we are correlating on. Hard-coding FIXTURE
   * here would make the composite key separate nothing, and switching provider
   * would silently create a second row for a flight we already track.
   */
  private readonly source: Provider =
    env().FLIGHT_PROVIDER === 'fr24' ? 'FR24' : 'FIXTURE';

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertStream,
  ) {}

  /**
   * Losing a race is a normal outcome here, not an error: it means another
   * writer committed first. Re-read and try again, with a little jitter so two
   * contending workers do not march back in lockstep.
   *
   * The retry lives OUTSIDE the transaction on purpose. Catching a failed write
   * inside one leaves Postgres in an aborted-transaction state where every
   * subsequent statement fails, so the "recovery" would silently discard the
   * writes that had already succeeded.
   */
  async process(
    snapshot: FlightSnapshot,
    eventId?: string,
  ): Promise<IngestResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.processOnce(snapshot, eventId);
      } catch (error) {
        const lostARace =
          error instanceof ConcurrencyError || isUniqueViolation(error);

        if (!lostARace || attempt >= MAX_ATTEMPTS - 1) throw error;

        await sleep(
          Math.min(20 * 2 ** attempt, BACKOFF_CEILING_MS) + Math.random() * 20,
        );
      }
    }
  }

  private async processOnce(
    snapshot: FlightSnapshot,
    eventId?: string,
  ): Promise<IngestResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // L1. Inside the transaction, so a failed attempt releases the id rather
      // than burning it. If this insert committed separately and the work below
      // then rolled back, the retry would see "already handled" and the change
      // would be lost for good with nothing in the logs to say so.
      if (eventId !== undefined) {
        const claimed = await tx.ingestEvent.createMany({
          data: [
            {
              eventId,
              providerFlightId: snapshot.providerFlightId,
              payloadHash: hashSnapshot(snapshot),
              outcome: 'DUPLICATE',
            },
          ],
          skipDuplicates: true,
        });

        if (claimed.count === 0) {
          return {
            outcome: 'DUPLICATE' as const,
            flightId: null,
            changes: 0,
            alerts: 0,
          };
        }
      }

      const flight = await tx.flight.findUnique({
        where: {
          providerSource_providerFlightId: {
            providerSource: this.source,
            providerFlightId: snapshot.providerFlightId,
          },
        },
      });

      if (flight === null) {
        return this.createFlight(tx, snapshot, eventId);
      }

      // Out of order. Strict `<` on purpose: provider clocks have second
      // resolution, so two genuine changes can share a timestamp. Dropping a
      // real change is worse than applying a redundant one, so equal timestamps
      // are allowed through.
      if (+snapshot.sourceTimestamp < +flight.sourceTimestamp) {
        await this.recordOutcome(tx, eventId, 'STALE');
        return {
          outcome: 'STALE' as const,
          flightId: flight.id,
          changes: 0,
          alerts: 0,
        };
      }

      // L2.
      const changes = detectChanges(flight, snapshot);

      if (changes.length === 0) {
        // Guarded on sourceTimestamp rather than on revision. This branch does
        // not bump the revision, so a revision guard would let two concurrent
        // no-change writers rewind each other — and an unguarded update is
        // worse still: a writer that read at an older timestamp waits on the
        // row lock, sees its `id` predicate still match after a real change
        // commits, and overwrites the watermark with its own stale value. The
        // corruption lands in the exact column the ordering check above relies
        // on, so the next genuinely stale snapshot is then applied as fresh and
        // raises an alert for a change that never happened.
        await tx.flight.updateMany({
          where: {
            id: flight.id,
            sourceTimestamp: { lte: snapshot.sourceTimestamp },
          },
          data: {
            sourceTimestamp: snapshot.sourceTimestamp,
            lastSyncedAt: new Date(),
            lastPolledAt: new Date(),
          },
        });
        await this.recordOutcome(tx, eventId, 'NO_CHANGE');
        return {
          outcome: 'NO_CHANGE' as const,
          flightId: flight.id,
          changes: 0,
          alerts: 0,
        };
      }

      // L3. Compare and swap. Zero rows means someone else moved the flight
      // between our read and this write.
      const fromRevision = flight.revision;
      const applied: Prisma.FlightUpdateManyMutationInput = {
        revision: fromRevision + 1,
        sourceTimestamp: snapshot.sourceTimestamp,
        lastSyncedAt: new Date(),
        lastPolledAt: new Date(),
      };

      for (const change of changes) {
        if (change.field === 'FLIGHT_NUMBER')
          applied.flightNumber = change.newValue;
        else applied.aircraftRegistration = change.newValue;
      }

      const swapped = await tx.flight.updateMany({
        where: { id: flight.id, revision: fromRevision },
        data: applied,
      });

      if (swapped.count === 0) {
        throw new ConcurrencyError(flight.id, fromRevision);
      }

      let alertCount = 0;

      for (const change of changes) {
        const recorded = await tx.flightChange.create({
          data: {
            flightId: flight.id,
            field: change.field,
            fromRevision,
            toRevision: fromRevision + 1,
            oldValue: change.oldValue,
            newValue: change.newValue,
          },
        });

        if (!change.alertable) continue;

        const message = formatAlert(change, {
          // The flight number as it was when we detected the change, so the
          // operator can line the alert up with the feed they last saw.
          flightNumber: flight.flightNumber,
          origin: flight.origin,
          destination: flight.destination,
          flightDate: flight.flightDate.toISOString().slice(0, 10),
        });

        await tx.alert.create({
          data: {
            flightId: flight.id,
            changeId: recorded.id,
            title: message.title,
            body: message.body,
          },
        });

        alertCount += 1;
      }

      await this.recordOutcome(tx, eventId, 'APPLIED');

      return {
        outcome: 'APPLIED' as const,
        flightId: flight.id,
        changes: changes.length,
        alerts: alertCount,
      };
    });

    // Side effects only after the transaction commits. Publishing inside it
    // would show subscribers an alert that a rollback then erased.
    if (result.outcome === 'APPLIED' && result.alerts > 0 && result.flightId) {
      this.alerts.publish(result.flightId);
    }

    return result;
  }

  private async createFlight(
    tx: Prisma.TransactionClient,
    snapshot: FlightSnapshot,
    eventId: string | undefined,
  ): Promise<IngestResult> {
    // A first sighting is recorded but raises nothing. Learning a flight exists
    // is not a change to it, and nobody should be paged for it.
    const created = await tx.flight.create({
      data: {
        providerSource: this.source,
        providerFlightId: snapshot.providerFlightId,
        flightNumber: snapshot.flightNumber ?? UNKNOWN_FLIGHT_NUMBER,
        aircraftRegistration: snapshot.aircraftRegistration ?? null,
        flightDate: new Date(
          snapshot.sourceTimestamp.toISOString().slice(0, 10),
        ),
        // Written here, not left null. If the ordering column only starts
        // moving at the first change, every flight spends the longest part of
        // its life with the staleness guard switched off.
        sourceTimestamp: snapshot.sourceTimestamp,
        lastSyncedAt: new Date(),
        lastPolledAt: new Date(),
      },
    });

    await this.recordOutcome(tx, eventId, 'CREATED');

    return { outcome: 'CREATED', flightId: created.id, changes: 0, alerts: 0 };
  }

  /** Answers "was this delivery applied, and if not why not" after the fact. */
  private async recordOutcome(
    tx: Prisma.TransactionClient,
    eventId: string | undefined,
    outcome: IngestOutcome,
  ): Promise<void> {
    if (eventId === undefined) return;
    await tx.ingestEvent.update({ where: { eventId }, data: { outcome } });
  }
}

function hashSnapshot(snapshot: FlightSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
