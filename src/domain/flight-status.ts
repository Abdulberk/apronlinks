import type { FlightStatus, FlightTimes } from './types';

/**
 * Flight status is not a field you read — it is a value you derive.
 *
 * These rules are FlightAware's own, from the AeroAPI FAQ:
 *
 *   actual_off == null                      -> has not departed yet
 *   actual_off != null && actual_on == null -> currently en route
 *   both set and different                  -> arrived
 *   both set and EQUAL                      -> "the flight result is unknown
 *                                              and has probably arrived but we
 *                                              don't have an arrival
 *                                              confirmation"
 *
 * That last case is the one worth knowing: treating it as ARRIVED would stop
 * tracking a flight whose outcome was never confirmed.
 */
export function deriveStatus(times: FlightTimes): FlightStatus {
  if (times.cancelled === true) return 'CANCELLED';
  if (times.actualOff === null) return 'SCHEDULED';
  if (times.actualOn === null) return 'AIRBORNE';
  if (+times.actualOff === +times.actualOn) return 'RESULT_UNKNOWN';
  return 'ARRIVED';
}
