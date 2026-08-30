import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { IngestModule } from '../src/ingest/ingest.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { IngestService } from '../src/ingest/ingest.service';
import { IngestController } from '../src/ingest/ingest.controller';
import type { FlightSnapshot } from '../src/domain';
import type { Flight } from '../src/generated/prisma/client';

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

/** Everything these tests create, removed both before and after the run. */
const SCRATCH_IDS = ['e2e-alx314', 'wm-alx314'];

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
    // Clean up on the way out as well as on the way in. Rows left behind show
    // up on the dashboard as flights with no route and no schedule, so a
    // reviewer who runs the suite and then opens the page finds test debris
    // sitting among the real data.
    await prisma.flight.deleteMany({
      where: { providerFlightId: { in: SCRATCH_IDS } },
    });
    await prisma.ingestEvent.deleteMany({
      where: { providerFlightId: { in: SCRATCH_IDS } },
    });
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

describe('IngestService — watermark integrity (real Postgres)', () => {
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
    // Clean up on the way out as well as on the way in. Rows left behind show
    // up on the dashboard as flights with no route and no schedule, so a
    // reviewer who runs the suite and then opens the page finds test debris
    // sitting among the real data.
    await prisma.flight.deleteMany({
      where: { providerFlightId: { in: SCRATCH_IDS } },
    });
    await prisma.ingestEvent.deleteMany({
      where: { providerFlightId: { in: SCRATCH_IDS } },
    });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({
      where: { providerFlightId: { startsWith: 'wm-' } },
    });
  });

  const wm = (over: Partial<FlightSnapshot> = {}): FlightSnapshot => ({
    providerFlightId: 'wm-alx314',
    sourceTimestamp: new Date('2026-08-26T10:00:00Z'),
    ...over,
  });

  it('never lets a no-change snapshot rewind the ordering watermark', async () => {
    // This has to be concurrent to mean anything. Run sequentially, the late
    // snapshot is caught by the ordering guard at the top of process() and
    // never reaches the no-change branch at all — so a sequential version of
    // this test passes even with the guard removed, which makes it worthless.
    //
    // Concurrently, both writers read at the same old watermark, both pass the
    // ordering guard, and the no-change writer commits second. Unguarded, its
    // update still matches on id and writes its own older timestamp back over
    // the one the real change just set, corrupting the column the staleness
    // check depends on.
    for (let round = 0; round < 8; round++) {
      await prisma.flight.deleteMany({
        where: { providerFlightId: { startsWith: 'wm-' } },
      });

      const created = await ingest.process(
        wm({ flightNumber: 'ALX314', aircraftRegistration: 'NQ-ATC' }),
      );
      const flightId = created.flightId!;

      await Promise.all([
        ingest.process(
          wm({
            aircraftRegistration: 'NQ-BRD',
            sourceTimestamp: new Date('2026-08-26T10:05:00Z'),
          }),
        ),
        ingest.process(
          wm({ sourceTimestamp: new Date('2026-08-26T10:01:00Z') }),
        ),
      ]);

      const flight = await prisma.flight.findUniqueOrThrow({
        where: { id: flightId },
      });

      // The watermark may only ever move forward.
      expect(flight.sourceTimestamp.toISOString()).toBe(
        '2026-08-26T10:05:00.000Z',
      );
    }
  });
});

/**
 * The demo buttons are how a reviewer sees the feature at all, so they get the
 * same treatment as the rest.
 *
 * This exists because of a real bug: the renumber demo looked its flight up by
 * flight number, which is one of the two fields it changes. It worked once and
 * then 404'd for good — the project's own thesis, violated in its own demo.
 */
describe('IngestController — demo triggers (real Postgres)', () => {
  let prisma: PrismaService;
  let controller: IngestController;

  const DEMO_IDS = ['seed-alx314', 'seed-tk1985'];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, IngestModule],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(IngestController);
  });

  /**
   * These are the seeded demo flights, not scratch rows, because the bug being
   * covered lives in the fallback lookup that only fires when no id is passed —
   * and that fallback names the seeded flights specifically.
   *
   * So the suite has to put them back rather than clean them up. Deleting them
   * would leave a reviewer who ran the tests looking at a dashboard missing two
   * flights, including the one the brief names in its own example.
   */
  const reset = async (): Promise<void> => {
    await prisma.flight.deleteMany({
      where: { providerFlightId: { in: DEMO_IDS } },
    });

    await prisma.flight.createMany({
      data: [
        {
          providerFlightId: 'seed-alx314',
          flightNumber: 'ALX314',
          aircraftRegistration: 'NQ-ATC',
          flightDate: new Date('2026-08-28'),
          sourceTimestamp: new Date('2026-08-28T08:00:00Z'),
          lastSyncedAt: new Date('2026-08-28T08:00:00Z'),
          providerSource: 'FIXTURE',
        },
        {
          providerFlightId: 'seed-tk1985',
          flightNumber: 'TK1985',
          aircraftRegistration: 'TC-JJA',
          flightDate: new Date('2026-08-28'),
          sourceTimestamp: new Date('2026-08-28T08:00:00Z'),
          lastSyncedAt: new Date('2026-08-28T08:00:00Z'),
          providerSource: 'FIXTURE',
        },
      ],
    });
  };

  beforeEach(reset);

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  const flight = (providerFlightId: string) =>
    prisma.flight.findFirstOrThrow({ where: { providerFlightId } });

  it('renumbers a flight, and can still find it to renumber it back', async () => {
    const first = await controller.demoNumberChange({});
    expect(first.outcome).toBe('APPLIED');
    expect((await flight('seed-tk1985')).flightNumber).toBe('TK1907');

    // The press that used to 404: the flight no longer answers to the number
    // it was looked up by.
    const second = await controller.demoNumberChange({});
    expect(second.outcome).toBe('APPLIED');
    expect((await flight('seed-tk1985')).flightNumber).toBe('TK1985');
  });

  it('swaps a tail back and forth without losing the flight', async () => {
    await controller.demoTailSwap({});
    expect((await flight('seed-alx314')).aircraftRegistration).toBe('NQ-BRD');

    await controller.demoTailSwap({});
    expect((await flight('seed-alx314')).aircraftRegistration).toBe('NQ-ATC');
  });

  it('records every press as its own change rather than collapsing the return', async () => {
    await controller.demoNumberChange({});
    await controller.demoNumberChange({});
    await controller.demoNumberChange({});

    const changes = await prisma.flightChange.findMany({
      where: { flight: { providerFlightId: 'seed-tk1985' } },
    });

    // TK1985 → TK1907 → TK1985 → TK1907. Three real changes, not one repeated.
    expect(changes).toHaveLength(3);
  });

  it('moves the two demo flights independently', async () => {
    await controller.demoTailSwap({});

    const untouched = await flight('seed-tk1985');
    expect(untouched.flightNumber).toBe('TK1985');
    expect(untouched.revision).toBe(0);
  });
});

/**
 * The two demo paths share one flight's ordering watermark, so they can lock
 * each other out. They did: the button stamped +60s unconditionally, and after
 * a few presses the stored timestamp was minutes ahead of the wall clock, so
 * the signed script — which stamps with the real clock — came back STALE where
 * the README promises APPLIED.
 */
describe('IngestController — demo triggers stay in step with the clock', () => {
  let prisma: PrismaService;
  let controller: IngestController;
  let ingest: IngestService;

  const ID = 'seed-alx314';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, IngestModule],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(IngestController);
    ingest = moduleRef.get(IngestService);
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { providerFlightId: ID } });
    // Stamped NOW, not in the past. With a past timestamp the old +60s bug
    // cannot show itself — six minutes of drift from this morning is still
    // behind the wall clock, so the test would pass with the bug present.
    const now = new Date();
    await prisma.flight.create({
      data: {
        providerFlightId: ID,
        flightNumber: 'ALX314',
        aircraftRegistration: 'NQ-ATC',
        flightDate: new Date('2026-08-28'),
        sourceTimestamp: now,
        lastSyncedAt: now,
        providerSource: 'FIXTURE',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('never pushes the watermark past the wall clock', async () => {
    for (let i = 0; i < 6; i += 1) await controller.demoTailSwap({});

    const flight = await prisma.flight.findFirstOrThrow({
      where: { providerFlightId: ID },
    });

    expect(+flight.sourceTimestamp).toBeLessThanOrEqual(Date.now());
  });

  it('leaves a real-clock delivery still able to apply after six presses', async () => {
    for (let i = 0; i < 6; i += 1) await controller.demoTailSwap({});

    // Exactly what `pnpm demo:change` sends: a fresh value, stamped now.
    const result = await ingest.process(
      {
        providerFlightId: ID,
        aircraftRegistration: 'NQ-XYZ',
        sourceTimestamp: new Date(),
      },
      `clock-check-${Date.now()}`,
    );

    expect(result.outcome).toBe('APPLIED');
  });
});

/**
 * Status used to be a column nothing ever wrote: deriveStatus was implemented
 * and fully tested but never called, because FlightSnapshot carried no times.
 * A flight therefore stayed SCHEDULED for ever, sat on the unscheduled watch
 * for ever, and never stopped being tracked.
 */
describe('IngestService — movement and status (real Postgres)', () => {
  let prisma: PrismaService;
  let ingest: IngestService;

  const ID = 'e2e-move';
  const OFF = new Date('2026-08-30T12:00:00Z');
  const ON = new Date('2026-08-30T15:00:00Z');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, IngestModule],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    ingest = moduleRef.get(IngestService);
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { providerFlightId: ID } });
    await prisma.ingestEvent.deleteMany({ where: { providerFlightId: ID } });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { providerFlightId: ID } });
    await prisma.ingestEvent.deleteMany({ where: { providerFlightId: ID } });
    await prisma.$disconnect();
  });

  const send = (over: Partial<FlightSnapshot>, at: string) =>
    ingest.process({
      providerFlightId: ID,
      sourceTimestamp: new Date(at),
      ...over,
    });

  const read = () =>
    prisma.flight.findFirstOrThrow({ where: { providerFlightId: ID } });

  it('carries a flight from scheduled to airborne to arrived', async () => {
    await send({ flightNumber: 'TK1985' }, '2026-08-30T10:00:00Z');
    expect((await read()).status).toBe('SCHEDULED');

    await send({ actualOff: OFF }, '2026-08-30T12:01:00Z');
    const airborne = await read();
    expect(airborne.status).toBe('AIRBORNE');
    expect(airborne.arrivedAt).toBeNull();

    await send({ actualOn: ON }, '2026-08-30T15:01:00Z');
    const arrived = await read();
    expect(arrived.status).toBe('ARRIVED');
    expect(arrived.arrivedAt).toEqual(ON);
  });

  /**
   * A status move is not one of the two watched fields, so it must be applied
   * without bumping the revision, writing history, or raising an alert.
   */
  it('applies a status move without an alert, a change row or a revision bump', async () => {
    const created = await send(
      { flightNumber: 'TK1985' },
      '2026-08-30T10:00:00Z',
    );
    const before = await read();

    const result = await send({ actualOff: OFF }, '2026-08-30T12:01:00Z');
    const after = await read();

    expect(result.outcome).toBe('NO_CHANGE');
    expect(result.alerts).toBe(0);
    expect(after.status).toBe('AIRBORNE');
    expect(after.revision).toBe(before.revision);
    expect(
      await prisma.flightChange.count({
        where: { flightId: created.flightId! },
      }),
    ).toBe(0);
  });

  it('records a tail change and the departure from the same snapshot', async () => {
    await send(
      { flightNumber: 'TK1985', aircraftRegistration: 'TC-JJA' },
      '2026-08-30T10:00:00Z',
    );

    const result = await send(
      { aircraftRegistration: 'TC-LGA', actualOff: OFF },
      '2026-08-30T12:01:00Z',
    );
    const after = await read();

    expect(result.outcome).toBe('APPLIED');
    expect(result.alerts).toBe(1);
    expect(after.aircraftRegistration).toBe('TC-LGA');
    expect(after.status).toBe('AIRBORNE');
    expect(after.revision).toBe(1);
  });

  it('does not un-depart a flight when a later snapshot omits the takeoff', async () => {
    await send({ flightNumber: 'TK1985' }, '2026-08-30T10:00:00Z');
    await send({ actualOff: OFF }, '2026-08-30T12:01:00Z');

    await send({ flightNumber: 'TK1985' }, '2026-08-30T12:05:00Z');

    const after = await read();
    expect(after.status).toBe('AIRBORNE');
    expect(after.actualOff).toEqual(OFF);
  });

  it('leaves a never-confirmed arrival tracked rather than settled', async () => {
    await send({ flightNumber: 'TK1985' }, '2026-08-30T10:00:00Z');
    await send({ actualOff: OFF }, '2026-08-30T12:01:00Z');
    await send({ actualOn: new Date(+OFF) }, '2026-08-30T15:01:00Z');

    const after = await read();
    expect(after.status).toBe('RESULT_UNKNOWN');
    expect(after.arrivedAt).toBeNull();
  });
});

/**
 * The demo lookup used to search by providerFlightId alone. That id only means
 * something inside the provider that issued it — which is why the schema keys
 * on the pair — so an unscoped lookup found a row belonging to another
 * provider. Ingest then failed to match it in its own namespace and created a
 * SECOND flight for the same aircraft.
 *
 * Proved by removing the fixture row and leaving only a same-id FR24 row: a
 * scoped lookup correctly finds nothing, an unscoped one finds the wrong
 * flight. The seeded row is put back afterwards — the dashboard demo depends
 * on it.
 */
describe('IngestController — demo lookup is scoped by provider', () => {
  let prisma: PrismaService;
  let controller: IngestController;
  let seeded: Flight;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, IngestModule],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(IngestController);

    seeded = await prisma.flight.findFirstOrThrow({
      where: { providerSource: 'FIXTURE', providerFlightId: 'seed-alx314' },
    });

    await prisma.flight.delete({ where: { id: seeded.id } });
    await prisma.flight.create({
      data: {
        ...seeded,
        id: undefined,
        providerSource: 'FR24',
        revision: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({
      where: { providerSource: 'FR24', providerFlightId: 'seed-alx314' },
    });
    await prisma.flight.create({ data: { ...seeded, id: undefined } });
    await prisma.$disconnect();
  });

  it('will not reach into another provider namespace', async () => {
    await expect(controller.demoTailSwap({})).rejects.toThrow(
      NotFoundException,
    );

    // And nothing was minted on the way past.
    expect(
      await prisma.flight.count({ where: { providerFlightId: 'seed-alx314' } }),
    ).toBe(1);
  });
});
