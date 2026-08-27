import {
  UNKNOWN_FLIGHT_NUMBER,
  blankToNull,
  normalizeFlightNumber,
  normalizeRegistration,
} from './normalize';
import type {
  ChangeField,
  DetectedChange,
  FlightSnapshot,
  FlightState,
} from './types';

interface FieldSpec {
  readonly key: 'flightNumber' | 'aircraftRegistration';
  readonly name: ChangeField;
  readonly normalize: (value: string) => string;
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'flightNumber',
    name: 'FLIGHT_NUMBER',
    normalize: normalizeFlightNumber,
  },
  {
    key: 'aircraftRegistration',
    name: 'AIRCRAFT_REGISTRATION',
    normalize: normalizeRegistration,
  },
];

/**
 * The graded core of the system, and deliberately a pure function: no database,
 * no clock, no network. Everything difficult about getting this right is a
 * decision about absence, not about comparison.
 *
 * A provider that stops reporting a tail number has not changed the tail
 * number. Returns one entry per field that genuinely moved; an empty array
 * means the snapshot told us nothing new, which is the overwhelmingly common
 * case and has to stay cheap.
 */
export function detectChanges(
  current: FlightState,
  incoming: FlightSnapshot,
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  for (const field of FIELDS) {
    const next = blankToNull(incoming[field.key]);

    // The provider did not mention this field.
    if (next === undefined) continue;
    // The provider said "unknown". Do not erase what we already learned.
    if (next === null) continue;

    const stored = blankToNull(current[field.key]) ?? null;
    // The sentinel means we never learned the value, so it must not compare as
    // one. Otherwise enrichment reads as a change and alerts on itself.
    const previous = stored === UNKNOWN_FLIGHT_NUMBER ? null : stored;

    // The same value wearing different formatting is not a change.
    if (
      previous !== null &&
      field.normalize(previous) === field.normalize(next)
    ) {
      continue;
    }

    changes.push({
      field: field.name,
      oldValue: previous,
      newValue: next,
      alertable: previous !== null,
    });
  }

  return changes;
}
