import { Test } from '@nestjs/testing';
import { IngestModule } from '../src/ingest/ingest.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { IngestService } from '../src/ingest/ingest.service';
import type { FlightSnapshot } from '../src/domain';

/**
 * These run against the real Postgres from docker-compose, not an in-memory
 * substitute. Every guarantee being tested here — the compare-and-swap, the
 * unique index on (flightId, field, fromRevision), ON CONFLICT DO NOTHING,
 * transaction rollback — is enforced by the database. Testing them against a
 * fake would only test the fake.
 *
 *   docker compose up -d postgres redis
 *   pnpm test:e2e
 */

const PROVIDER_FLIGHT_ID = 'e2e-alx314';

const snapshot = (over: Partial<FlightSnapshot> = {}): FlightSnapshot => ({
  providerFlightId: PROVIDER_FLIGHT_ID,
  sourceTimestamp: new Date('2026-08-26T10:00:00Z'),
  ...over,
});

describe('IngestService (real Postgres)', () => {
  let prisma: PrismaService;
  let ingest: IngestService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, IngestModule],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    ingest = moduleRef.get(IngestService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Cascades clear changes and alerts with the flight.
    await prisma.flight.deleteMany({
      where: { providerFlightId: { startsWith: 'e2e-' } },
    });
    await prisma.ingestEvent.deleteMany({
      where: { providerFlightId: { startsWith: 'e2e-' } },
    });
  });

  /** Establishes the flight so later snapshots are changes rather than creates. */
  async function seedFlight(): Promise<string> {
    const result = await ingest.process(
      snapshot({ flightNumber: 'ALX314', aircraftRegistration: 'NQ-ATC' }),
    );
    expect(result.outcome).toBe('CREATED');
    return result.flightId!;
  }

  it('records a first sighting without raising an alert', async () => {
    const result = await ingest.process(
      snapshot({ flightNumber: 'ALX314', aircraftRegistration: 'NQ-ATC' }),
    );

    expect(result.outcome).toBe('CREATED');
    expect(result.alerts).toBe(0);
    expect(
      await prisma.alert.count({ where: { flightId: result.flightId! } }),
    ).toBe(0);
  });

  it('turns a registration change into one change and one alert', async () => {
    const flightId = await seedFlight();

    const result = await ingest.process(
      snapshot({
        aircraftRegistration: 'NQ-BRD',
        sourceTimestamp: new Date('2026-08-26T10:05:00Z'),
      }),
    );

    expect(result.outcome).toBe('APPLIED');

    const alert = await prisma.alert.findFirstOrThrow({ where: { flightId } });
    expect(alert.title).toBe('Aircraft Change Detected');
    expect(alert.body).toBe(
      'Flight ALX314: Aircraft registration changed from NQ-ATC to NQ-BRD.',
    );
  });

  it('suppresses a replayed delivery by its event id', async () => {
    const flightId = await seedFlight();
    const later = snapshot({
      aircraftRegistration: 'NQ-BRD',
      sourceTimestamp: new Date('2026-08-26T10:05:00Z'),
    });

    const first = await ingest.process(later, 'evt-replay-1');
    const second = await ingest.process(later, 'evt-replay-1');

    expect(first.outcome).toBe('APPLIED');
    expect(second.outcome).toBe('DUPLICATE');
    expect(await prisma.flightChange.count({ where: { flightId } })).toBe(1);
    expect(await prisma.alert.count({ where: { flightId } })).toBe(1);
  });

  it('suppresses the same content arriving under a different event id', async () => {
    // Proves the content guard stands on its own: the replay guard cannot help
    // here because each delivery is genuinely distinct.
    const flightId = await seedFlight();
    const later = snapshot({
      aircraftRegistration: 'NQ-BRD',
      sourceTimestamp: new Date('2026-08-26T10:05:00Z'),
    });

    await ingest.process(later, 'evt-a');
    const second = await ingest.process(later, 'evt-b');

    expect(second.outcome).toBe('NO_CHANGE');
    expect(await prisma.flightChange.count({ where: { flightId } })).toBe(1);
  });

  it('drops a snapshot that is older than what we already hold', async () => {
    const flightId = await seedFlight();

    await ingest.process(
      snapshot({
        aircraftRegistration: 'NQ-BRD',
        sourceTimestamp: new Date('2026-08-26T10:05:00Z'),
      }),
    );

    const late = await ingest.process(
      snapshot({
        aircraftRegistration: 'NQ-ATC',
        sourceTimestamp: new Date('2026-08-26T10:02:00Z'),
      }),
    );

    expect(late.outcome).toBe('STALE');
    expect(await prisma.flightChange.count({ where: { flightId } })).toBe(1);

    const flight = await prisma.flight.findUniqueOrThrow({
      where: { id: flightId },
    });
    expect(flight.aircraftRegistration).toBe('NQ-BRD');
  });

  it('records both fields of one snapshot at the same revision', async () => {
    const flightId = await seedFlight();

    const result = await ingest.process(
      snapshot({
        flightNumber: 'ALX320',
        aircraftRegistration: 'NQ-BRD',
        sourceTimestamp: new Date('2026-08-26T10:05:00Z'),
      }),
    );

    expect(result.changes).toBe(2);
    expect(result.alerts).toBe(2);

    const changes = await prisma.flightChange.findMany({ where: { flightId } });
    // The unique index is per field, so two changes legitimately share a
    // fromRevision. One state transition, two things that moved inside it.
    expect(changes.map((c) => c.fromRevision)).toEqual([0, 0]);

    const flight = await prisma.flight.findUniqueOrThrow({
      where: { id: flightId },
    });
    expect(flight.revision).toBe(1);
  });

  it('keeps every leg of a flip-flop', async () => {
    // ATC -> BRD -> ATC -> BRD is three real changes. A uniqueness key built
    // from the values would suppress the third as a duplicate of the first.
    const flightId = await seedFlight();

    const values = ['NQ-BRD', 'NQ-ATC', 'NQ-BRD'];
    for (const [index, registration] of values.entries()) {
      await ingest.process(
        snapshot({
          aircraftRegistration: registration,
          sourceTimestamp: new Date(Date.UTC(2026, 7, 26, 10, 5 + index)),
        }),
      );
    }

    const changes = await prisma.flightChange.findMany({
      where: { flightId },
      orderBy: { fromRevision: 'asc' },
    });

    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.fromRevision)).toEqual([0, 1, 2]);
    expect(changes.map((c) => c.newValue)).toEqual(values);
  });

  it('loses no change when five different values race', async () => {
    // The real test of the compare-and-swap. Five writers contend on one row;
    // every one must land, exactly once, with a gapless revision sequence.
    //
    // Asserting on identical concurrent values instead would prove nothing —
    // that passes even if four of the five are silently dropped.
    //
    // All five share one sourceTimestamp on purpose. Giving them increasing
    // timestamps would test something else entirely: whichever writer commits
    // first raises the flight's watermark, and the ones still retrying then
    // correctly drop themselves as stale. That interaction is real and is
    // pinned by the test below; here we want the lock isolated.
    const flightId = await seedFlight();

    const registrations = ['NQ-B01', 'NQ-B02', 'NQ-B03', 'NQ-B04', 'NQ-B05'];
    const sameInstant = new Date('2026-08-26T11:00:00Z');

    await Promise.all(
      registrations.map((registration) =>
        ingest.process(
          snapshot({
            aircraftRegistration: registration,
            sourceTimestamp: sameInstant,
          }),
        ),
      ),
    );

    const changes = await prisma.flightChange.findMany({
      where: { flightId },
      orderBy: { fromRevision: 'asc' },
    });

    expect(changes).toHaveLength(5);
    expect(changes.map((c) => c.fromRevision)).toEqual([0, 1, 2, 3, 4]);

    const flight = await prisma.flight.findUniqueOrThrow({
      where: { id: flightId },
    });
    expect(flight.revision).toBe(5);
    expect(await prisma.alert.count({ where: { flightId } })).toBe(5);
  });

  it('drops a contending writer that has become stale while retrying', async () => {
    // The ordering guard and the retry interact, and the result is worth
    // pinning rather than discovering later. A writer that loses the race
    // re-reads before trying again — and if a newer snapshot won in the
    // meantime, the re-read correctly finds it is now the older one.
    //
    // So concurrent writes carrying increasing timestamps do NOT all land, and
    // that is the intended behaviour: the newest observation of the world is
    // the one worth keeping.
    const flightId = await seedFlight();

    const registrations = ['NQ-C01', 'NQ-C02', 'NQ-C03', 'NQ-C04', 'NQ-C05'];

    const results = await Promise.all(
      registrations.map((registration, index) =>
        ingest.process(
          snapshot({
            aircraftRegistration: registration,
            sourceTimestamp: new Date(Date.UTC(2026, 7, 26, 11, index)),
          }),
        ),
      ),
    );

    const applied = results.filter((r) => r.outcome === 'APPLIED').length;
    const stale = results.filter((r) => r.outcome === 'STALE').length;

    expect(applied + stale).toBe(registrations.length);
    expect(applied).toBeGreaterThan(0);

    // Whatever the interleaving, history stays consistent: one row per applied
    // change, revisions gapless, and the flight holding the newest value that
    // actually won.
    const changes = await prisma.flightChange.findMany({
      where: { flightId },
      orderBy: { fromRevision: 'asc' },
    });

    expect(changes).toHaveLength(applied);
    expect(changes.map((c) => c.fromRevision)).toEqual(
      Array.from({ length: applied }, (_, i) => i),
    );

    const flight = await prisma.flight.findUniqueOrThrow({
      where: { id: flightId },
    });
    expect(flight.revision).toBe(applied);
    expect(flight.aircraftRegistration).toBe(changes[applied - 1].newValue);
  });

  it('creates one flight when two first sightings race', async () => {
    const results = await Promise.all([
      ingest.process(
        snapshot({ flightNumber: 'ALX314', aircraftRegistration: 'NQ-ATC' }),
      ),
      ingest.process(
        snapshot({ flightNumber: 'ALX314', aircraftRegistration: 'NQ-ATC' }),
      ),
    ]);

    const flights = await prisma.flight.findMany({
      where: { providerFlightId: PROVIDER_FLIGHT_ID },
    });

    expect(flights).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'CREATED')).toHaveLength(1);
    expect(
      await prisma.alert.count({ where: { flightId: flights[0].id } }),
    ).toBe(0);
  });

  it('leaves no ingest event marked applied when the work did not commit', async () => {
    // The reason the replay guard sits inside the transaction. If it committed
    // separately, a failed attempt would burn the id and the retry would report
    // "already handled" while nothing had been written.
    const flightId = await seedFlight();

    await ingest.process(
      snapshot({
        aircraftRegistration: 'NQ-BRD',
        sourceTimestamp: new Date('2026-08-26T10:05:00Z'),
      }),
      'evt-outcome',
    );

    const event = await prisma.ingestEvent.findUniqueOrThrow({
      where: { eventId: 'evt-outcome' },
    });

    expect(event.outcome).toBe('APPLIED');
    expect(await prisma.flightChange.count({ where: { flightId } })).toBe(1);
  });
});
