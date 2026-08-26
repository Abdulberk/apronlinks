/**
 * Domain types. No NestJS, no Prisma, no I/O, no clock.
 *
 * The distinction that carries the most weight here is `undefined` vs `null`
 * on an incoming snapshot:
 *
 *   undefined -> the provider did not send the field. Silence is not
 *                information, so we must not touch what we already hold.
 *   null      -> the provider explicitly said "unknown". Still not a reason to
 *                erase a value we already learned.
 *
 * FlightAware's own documentation warns that virtually every field can be null,
 * and FR24's schema marks every field except its id as nullable. This is a
 * provider requirement, not defensive paranoia.
 */

export type ChangeField = 'FLIGHT_NUMBER' | 'AIRCRAFT_REGISTRATION';

export type FlightStatus =
  'SCHEDULED' | 'AIRBORNE' | 'ARRIVED' | 'CANCELLED' | 'RESULT_UNKNOWN';

/** What we currently believe about a flight. */
export interface FlightState {
  flightNumber: string;
  aircraftRegistration: string | null;
}

/**
 * What a provider just told us.
 *
 * `sourceTimestamp` is required and non-nullable on purpose. Both plausible
 * defaults fail silently in opposite directions: `null < someDate` coerces to
 * true, so every push would be judged stale forever; `undefined` means "do
 * nothing" to Prisma, so the ordering column would never advance. Making it
 * impossible at the type level is cheaper than either bug.
 */
export interface FlightSnapshot {
  providerFlightId: string;
  flightNumber?: string | null;
  aircraftRegistration?: string | null;
  sourceTimestamp: Date;
}

export interface DetectedChange {
  field: ChangeField;
  /** Null only on a first observation. */
  oldValue: string | null;
  newValue: string;
  /**
   * A first observation is recorded in history but must not page anyone.
   * Learning a tail code for the first time is enrichment, not a change.
   */
  alertable: boolean;
}

/** The subset of a flight that decides polling cadence. */
export interface PollableFlight {
  status: FlightStatus;
  /** Null for FR24-sourced flights: that API publishes no schedule at all. */
  scheduledDeparture: Date | null;
  arrivedAt: Date | null;
}

/** Provider times, used to derive status. */
export interface FlightTimes {
  cancelled?: boolean;
  /** Runway departure ("off"). */
  actualOff: Date | null;
  /** Runway arrival ("on"). */
  actualOn: Date | null;
}
