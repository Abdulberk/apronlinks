import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Seed data for the demo.
 *
 * Idempotent by design: it upserts on (providerSource, providerFlightId), so
 * running it twice — which `docker compose up` will do on any restart — leaves
 * exactly the same rows rather than a second copy of everything.
 *
 * ALX314 / NQ-ATC is deliberate. It is the flight from the brief's own example,
 * so `pnpm demo:change` produces the exact sentence the brief asks for:
 *
 *   Aircraft Change Detected
 *   Flight ALX314: Aircraft registration changed from NQ-ATC to NQ-BRD.
 *
 * The rest exist to populate the poll tiers, so the cadence table on the
 * dashboard shows something other than one row.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A fixed clock keeps the seeded tiers stable across runs. */
const now = new Date();
const at = (offsetMs: number): Date => new Date(+now + offsetMs);

/** Local departure date at the origin, as YYYY-MM-DD. */
const dateOf = (d: Date): Date => new Date(d.toISOString().slice(0, 10));

interface SeedFlight {
  providerFlightId: string;
  flightNumber: string;
  aircraftRegistration: string | null;
  aircraftHex: string | null;
  aircraftType: string | null;
  origin: string;
  destination: string;
  departsIn: number;
  status: 'SCHEDULED' | 'AIRBORNE' | 'ARRIVED';
}

const FLIGHTS: SeedFlight[] = [
  // The demo flight. Inside the 30-minute tier, so it polls every minute.
  {
    providerFlightId: 'seed-alx314',
    flightNumber: 'ALX314',
    aircraftRegistration: 'NQ-ATC',
    aircraftHex: '4CAD41',
    aircraftType: 'A20N',
    origin: 'EGLL',
    destination: 'KSEA',
    departsIn: 22 * MINUTE,
    status: 'SCHEDULED',
  },
  // Airborne: two-minute cadence.
  {
    providerFlightId: 'seed-tk1985',
    flightNumber: 'TK1985',
    aircraftRegistration: 'TC-JJA',
    aircraftHex: '4BA8C1',
    aircraftType: 'B77W',
    origin: 'LTFM',
    destination: 'KSEA',
    departsIn: -4 * HOUR,
    status: 'AIRBORNE',
  },
  {
    providerFlightId: 'seed-sk7679',
    flightNumber: 'SK7679',
    aircraftRegistration: 'EI-SIN',
    aircraftHex: '4CAD42',
    aircraftType: 'A20N',
    origin: 'ESSA',
    destination: 'GCFV',
    departsIn: -90 * MINUTE,
    status: 'AIRBORNE',
  },
  // Five-minute tier.
  {
    providerFlightId: 'seed-ba49',
    flightNumber: 'BA49',
    aircraftRegistration: 'G-ZBKA',
    aircraftHex: '4008F3',
    aircraftType: 'B789',
    origin: 'EGLL',
    destination: 'KSEA',
    departsIn: 95 * MINUTE,
    status: 'SCHEDULED',
  },
  {
    providerFlightId: 'seed-dl468',
    flightNumber: 'DL468',
    aircraftRegistration: 'N803DZ',
    aircraftHex: 'A9E3B7',
    aircraftType: 'A339',
    origin: 'KSEA',
    destination: 'EHAM',
    departsIn: 2 * HOUR + 40 * MINUTE,
    status: 'SCHEDULED',
  },
  // Thirty-minute tier.
  {
    providerFlightId: 'seed-af348',
    flightNumber: 'AF348',
    aircraftRegistration: 'F-HRBA',
    aircraftHex: '39C401',
    aircraftType: 'A359',
    origin: 'LFPG',
    destination: 'KSEA',
    departsIn: 8 * HOUR,
    status: 'SCHEDULED',
  },
  {
    providerFlightId: 'seed-lh490',
    flightNumber: 'LH490',
    aircraftRegistration: 'D-AIXP',
    aircraftHex: '3C6759',
    aircraftType: 'A359',
    origin: 'EDDM',
    destination: 'KSEA',
    departsIn: 19 * HOUR,
    status: 'SCHEDULED',
  },
  // Six-hour tier: beyond a day out, nobody is watching yet.
  {
    providerFlightId: 'seed-nh178',
    flightNumber: 'NH178',
    aircraftRegistration: 'JA936A',
    aircraftHex: '86E1D2',
    aircraftType: 'B789',
    origin: 'RJTT',
    destination: 'KSEA',
    departsIn: 31 * HOUR,
    status: 'SCHEDULED',
  },
  {
    providerFlightId: 'seed-ke19',
    flightNumber: 'KE19',
    aircraftRegistration: 'HL8348',
    aircraftHex: '71C0A9',
    aircraftType: 'B789',
    origin: 'RKSI',
    destination: 'KSEA',
    departsIn: 40 * HOUR,
    status: 'SCHEDULED',
  },
  // Arrived: settled, so tracking has stopped.
  {
    providerFlightId: 'seed-as1085',
    flightNumber: 'AS1085',
    aircraftRegistration: 'N265AK',
    aircraftHex: 'A2A1F0',
    aircraftType: 'B738',
    origin: 'KPDX',
    destination: 'KSEA',
    departsIn: -6 * HOUR,
    status: 'ARRIVED',
  },
  // No tail code known yet. The first snapshot carrying one is recorded in
  // history but raises no alert: learning a value is enrichment, not a change.
  {
    providerFlightId: 'seed-ua2043',
    flightNumber: 'UA2043',
    aircraftRegistration: null,
    aircraftHex: null,
    aircraftType: 'B739',
    origin: 'KSFO',
    destination: 'KSEA',
    departsIn: 5 * HOUR,
    status: 'SCHEDULED',
  },
  // Zero-padded as the provider sends it. Comparing raw would raise a false
  // alert the moment the same flight arrives unpadded.
  {
    providerFlightId: 'seed-qr0723',
    flightNumber: 'QR0723',
    aircraftRegistration: 'A7-BFG',
    aircraftHex: '06A1B4',
    aircraftType: 'B77L',
    origin: 'OTHH',
    destination: 'KSEA',
    departsIn: 14 * HOUR,
    status: 'SCHEDULED',
  },
];

async function main(): Promise<void> {
  for (const f of FLIGHTS) {
    const departure = at(f.departsIn);

    await prisma.flight.upsert({
      where: {
        providerSource_providerFlightId: {
          providerSource: 'FIXTURE',
          providerFlightId: f.providerFlightId,
        },
      },
      // Only the schedule-relative columns move on a re-seed, so the demo
      // starts from the same tier distribution without discarding any history
      // a previous run produced.
      update: {
        scheduledDeparture: departure,
        flightDate: dateOf(departure),
        arrivedAt: f.status === 'ARRIVED' ? at(f.departsIn + 2 * HOUR) : null,
      },
      create: {
        providerSource: 'FIXTURE',
        providerFlightId: f.providerFlightId,
        flightNumber: f.flightNumber,
        aircraftRegistration: f.aircraftRegistration,
        aircraftHex: f.aircraftHex,
        aircraftType: f.aircraftType,
        origin: f.origin,
        destination: f.destination,
        flightDate: dateOf(departure),
        scheduledDeparture: departure,
        status: f.status,
        arrivedAt: f.status === 'ARRIVED' ? at(f.departsIn + 2 * HOUR) : null,
        sourceTimestamp: now,
        lastSyncedAt: now,
        lastPolledAt: now,
        nextPollAt: now,
      },
    });
  }

  const total = await prisma.flight.count();
  console.log(`seeded ${FLIGHTS.length} flights (${total} total)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
