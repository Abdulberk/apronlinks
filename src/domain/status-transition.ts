import { deriveStatus } from './flight-status';
import type { FlightSnapshot, FlightStatus } from './types';

/** What we already hold about a flight's movement. */
export interface StoredTimes {
  actualOff: Date | null;
  actualOn: Date | null;
  status: FlightStatus;
  arrivedAt: Date | null;
}

/** What should be written, or null when nothing about movement moved. */
export interface StatusTransition {
  actualOff: Date | null;
  actualOn: Date | null;
  status: FlightStatus;
  arrivedAt: Date | null;
}

/**
 * Merge the movement times we hold with the ones a snapshot carries, then
 * derive the status from the result.
 *
 * This exists because `deriveStatus` is a pure rule over two timestamps, and
 * something has to decide WHICH two timestamps it sees. That decision is the
 * same absent-versus-null rule the watched fields already follow, and getting
 * it wrong is silent: a provider that omits `actual_off` on one poll would
 * un-depart an airborne flight and the cadence would jump back to the
 * pre-departure tier.
 *
 *   undefined -> the provider said nothing. Keep what we hold.
 *   null      -> the provider said "unknown". Still keep what we hold; a value
 *                we already learned is not erased by an absence of one.
 *   a Date    -> use it.
 *
 * `cancelled` is the exception, and deliberately so: it is the one movement
 * fact a provider states rather than omits, and it can only be turned ON here.
 * A snapshot that stops mentioning a cancellation has not un-cancelled the
 * flight.
 */
export function nextStatus(
  stored: StoredTimes,
  snapshot: FlightSnapshot,
): StatusTransition {
  const actualOff = snapshot.actualOff ?? stored.actualOff;
  const actualOn = snapshot.actualOn ?? stored.actualOn;

  const status = deriveStatus({
    cancelled: snapshot.cancelled === true || stored.status === 'CANCELLED',
    actualOff,
    actualOn,
  });

  return {
    actualOff,
    actualOn,
    status,
    // Only a confirmed arrival starts the settle window. RESULT_UNKNOWN must
    // not, or a flight whose outcome was never confirmed would stop being
    // watched thirty minutes later — which is the one case worth watching.
    arrivedAt: status === 'ARRIVED' ? actualOn : stored.arrivedAt,
  };
}

/** True when this transition would actually write something different. */
export function movementChanged(
  stored: StoredTimes,
  next: StatusTransition,
): boolean {
  return (
    +(next.actualOff ?? 0) !== +(stored.actualOff ?? 0) ||
    +(next.actualOn ?? 0) !== +(stored.actualOn ?? 0) ||
    next.status !== stored.status
  );
}
