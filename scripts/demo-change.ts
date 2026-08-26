/**
 * Posts a signed snapshot to the running service, the same way a provider
 * webhook would. Uses nothing but node:crypto, so there is no dependency to
 * install before a reviewer can run it.
 *
 *   pnpm demo:change            raise a tail change
 *   pnpm demo:change --replay   send the SAME delivery twice
 *
 * The replay flag is the point of the script. Duplicate prevention is invisible
 * when it works, so a second response saying DUPLICATE while the change count
 * stays where it was is the only way to actually watch it happen.
 */
import 'dotenv/config';
import { createHmac } from 'node:crypto';

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
const SECRET =
  process.env.INGEST_HMAC_SECRET ??
  'local-development-secret-not-for-production';

interface FlightRow {
  providerFlightId: string;
  aircraftRegistration: string | null;
}

function sign(body: string): string {
  const t = Math.floor(Date.now() / 1000).toString();
  const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function post(body: string): Promise<unknown> {
  const response = await fetch(`${BASE}/ingest/flight-snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
    body,
  });
  return response.json();
}

async function main(): Promise<void> {
  const listing = (await (await fetch(`${BASE}/flights`)).json()) as {
    flights: FlightRow[];
  };

  const target = listing.flights.find(
    (f) => f.providerFlightId === 'seed-alx314',
  );
  if (target === undefined) {
    throw new Error('seed flight not found — run the seed first');
  }

  const next = target.aircraftRegistration === 'NQ-ATC' ? 'NQ-BRD' : 'NQ-ATC';

  const body = JSON.stringify({
    eventId: `demo-${Date.now()}`,
    providerFlightId: 'seed-alx314',
    aircraftRegistration: next,
    sourceTimestamp: new Date().toISOString(),
  });

  console.log(`registration ${target.aircraftRegistration ?? '—'} -> ${next}`);
  console.log('first delivery   :', await post(body));

  if (process.argv.includes('--replay')) {
    // Byte-identical body, so the same delivery id. The replay guard should
    // refuse it without touching anything.
    console.log('replayed delivery:', await post(body));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
