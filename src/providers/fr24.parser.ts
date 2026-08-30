import { z } from 'zod';
import type { FlightSnapshot } from '../domain';

/**
 * Every field except the id is nullable in Flightradar24's own schema, so the
 * parser says so rather than discovering it in production. `.nullish()` keeps
 * "absent" and "explicitly null" distinct all the way through to change
 * detection, where the difference decides whether we overwrite what we hold.
 *
 * Not `.strict()`: a provider adding a field is a non-event, and failing on it
 * would turn their routine release into our outage.
 */
export const fr24FlightSummarySchema = z.object({
  fr24_id: z.string().min(1),
  flight: z.string().nullish(),
  callsign: z.string().nullish(),
  reg: z.string().nullish(),
  hex: z.string().nullish(),
  type: z.string().nullish(),
  orig_icao: z.string().nullish(),
  dest_icao: z.string().nullish(),
  datetime_takeoff: z.string().nullish(),
  datetime_landed: z.string().nullish(),
  first_seen: z.string().nullish(),
  last_seen: z.string().nullish(),
  flight_ended: z.union([z.boolean(), z.string()]).nullish(),
});

export type Fr24FlightSummary = z.infer<typeof fr24FlightSummarySchema>;

const HAS_ZONE = /[Zz]|[+-]\d{2}:?\d{2}$/;

/**
 * Flightradar24 is inconsistent with itself about time zones, and this was
 * measured rather than inferred: `live/flight-positions` returns
 * "2026-08-26T15:36:56Z" while `flight-summary` returns "2023-01-27T05:15:22"
 * with no zone at all. Both forms appear in their published schema examples for
 * the same field.
 *
 * JavaScript reads the zoneless form as LOCAL time. On a machine in Istanbul
 * that is a silent three-hour shift, in exactly the field used to decide
 * whether a snapshot is newer than what we already hold — so a stale update
 * would look fresh and overwrite a good value.
 *
 * The check is on the VALUE, not on which endpoint it came from. Appending Z
 * unconditionally would corrupt the half that already carries an offset.
 */
export function parseProviderTimestamp(value: string): Date {
  const normalized = HAS_ZONE.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);

  if (Number.isNaN(+parsed)) {
    throw new Error(`unparseable provider timestamp: ${value}`);
  }

  return parsed;
}

/**
 * Turns one provider record into the shape the domain works in.
 *
 * `fr24_id` becomes the correlation key. It is the only field the provider
 * guarantees, and — unlike the flight number or the registration — it does not
 * change when the thing it identifies changes.
 */
export function toSnapshot(
  record: Fr24FlightSummary,
  observedAt: Date,
): FlightSnapshot {
  // Prefer a provider timestamp over our own clock: ordering must be decided by
  // when the provider saw the world, not by when we happened to ask.
  const stamp =
    record.last_seen ?? record.datetime_takeoff ?? record.first_seen;

  return {
    providerFlightId: record.fr24_id,
    flightNumber: record.flight,
    aircraftRegistration: record.reg,
    sourceTimestamp: stamp ? parseProviderTimestamp(stamp) : observedAt,
    // Movement times, so status is derived from what the provider reports
    // rather than left at its default. Absent is left absent rather than
    // turned into null: the merge rule reads undefined as `the provider said
    // nothing`, and a null here would claim the provider said `unknown`.
    //
    // `flight_ended` is deliberately NOT mapped to `cancelled`. It means the
    // tracking session closed, which is what happens at the end of every
    // ordinary flight. FR24 publishes no cancellation field at all, so
    // `cancelled` stays unset here and CANCELLED is unreachable under FR24.
    ...(record.datetime_takeoff
      ? { actualOff: parseProviderTimestamp(record.datetime_takeoff) }
      : {}),
    ...(record.datetime_landed
      ? { actualOn: parseProviderTimestamp(record.datetime_landed) }
      : {}),
  };
}

/**
 * Parses per record rather than per response. One malformed entry in a batch of
 * ten should cost that entry, not the other nine.
 */
export function parseBatch(
  payload: unknown,
  observedAt: Date,
): { snapshots: FlightSnapshot[]; rejected: number } {
  const envelope = z.object({ data: z.array(z.unknown()) }).safeParse(payload);
  if (!envelope.success) return { snapshots: [], rejected: 0 };

  const snapshots: FlightSnapshot[] = [];
  let rejected = 0;

  for (const record of envelope.data.data) {
    const parsed = fr24FlightSummarySchema.safeParse(record);
    if (!parsed.success) {
      rejected += 1;
      continue;
    }

    try {
      snapshots.push(toSnapshot(parsed.data, observedAt));
    } catch {
      rejected += 1;
    }
  }

  return { snapshots, rejected };
}
