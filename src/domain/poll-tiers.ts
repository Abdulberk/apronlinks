import type { PollableFlight } from './types';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** How long after a confirmed arrival we keep watching before letting go. */
export const ARRIVAL_SETTLE = 30 * MINUTE;

/**
 * A flight that departed this long ago and never reported an arrival is
 * abandoned rather than tracked forever. Without this guard the pre-departure
 * branch would return a one-minute cadence for eternity.
 */
export const ABANDON_AFTER_DEPARTURE = 24 * HOUR;

/** Used when there is no schedule to reason about. */
export const UNSCHEDULED_WATCH = 15 * MINUTE;

/**
 * How fresh does this flight's data need to be, right now?
 *
 * Cadence tracks operational urgency, not the clock. Nobody cares about a tail
 * swap on a flight leaving in twenty hours; a tail swap twenty minutes before
 * departure means a ground crew has to move equipment now. Against a fixed
 * one-minute cadence this is roughly 87% fewer polls per flight per day, and
 * it is fresher in the window where freshness actually matters.
 *
 * Returns milliseconds until the next poll, or null to stop tracking.
 *
 * Note the unary plus on every date comparison. `someDate + 30 * MINUTE` is
 * string concatenation in JavaScript and the resulting comparison silently
 * evaluates to false — which is precisely how a stop condition ends up never
 * firing at all.
 */
export function nextPollDelay(
  flight: PollableFlight,
  now: Date,
): number | null {
  if (flight.status === 'CANCELLED') return null;

  if (flight.status === 'ARRIVED') {
    // Marked arrived but with no timestamp: keep a slow watch until one lands.
    if (flight.arrivedAt === null) return UNSCHEDULED_WATCH;
    return +now > +flight.arrivedAt + ARRIVAL_SETTLE ? null : 5 * MINUTE;
  }

  // The provider suspects it landed but cannot confirm. Keep a slow watch
  // rather than declaring arrival and dropping the flight.
  if (flight.status === 'RESULT_UNKNOWN') return UNSCHEDULED_WATCH;

  if (flight.status === 'AIRBORNE') return 2 * MINUTE;

  // FR24 publishes no scheduling data, so for flights sourced there this is
  // always null and the schedule-relative tiers below are unreachable. Fall
  // back to a steady watch rather than inventing a departure time.
  if (flight.scheduledDeparture === null) return UNSCHEDULED_WATCH;

  const untilDeparture = +flight.scheduledDeparture - +now;

  // Long past its slot and still not airborne or arrived: the flight is lost.
  if (untilDeparture < -ABANDON_AFTER_DEPARTURE) return null;

  if (untilDeparture <= 30 * MINUTE) return 1 * MINUTE;
  if (untilDeparture <= 3 * HOUR) return 5 * MINUTE;
  if (untilDeparture <= 24 * HOUR) return 30 * MINUTE;
  return 6 * HOUR;
}
