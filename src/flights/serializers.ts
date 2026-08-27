import type { Alert, Flight, FlightChange } from '../generated/prisma/client';

/**
 * Prisma has no date-only type, so a `@db.Date` column comes back as an instant
 * at UTC midnight. Serialising that directly sends "2026-08-27T00:00:00.000Z",
 * which a browser in Seattle renders as 26 August — a screen that contradicts
 * the scheduled departure printed next to it.
 *
 * The flight date is a calendar date at the origin, not a moment in time, so it
 * goes to the wire as one.
 */
export function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** How stale is what we are showing, and should the operator distrust it? */
export function staleness(
  lastSyncedAt: Date,
  now: Date,
  trackingActive = true,
): {
  seconds: number;
  label: 'LIVE' | 'STALE' | 'NO CONNECTION' | 'TRACKING ENDED';
} {
  const seconds = Math.max(0, Math.round((+now - +lastSyncedAt) / 1000));

  // A flight we deliberately stopped following is not a flight we have lost
  // contact with. Reporting it as NO CONNECTION describes a failure that did
  // not happen, and an operator who learns to ignore that label will ignore it
  // on the flight where it is real.
  if (!trackingActive) return { seconds, label: 'TRACKING ENDED' };

  if (seconds < 120) return { seconds, label: 'LIVE' };
  if (seconds < 900) return { seconds, label: 'STALE' };
  return { seconds, label: 'NO CONNECTION' };
}

export function serializeFlight(flight: Flight, now = new Date()) {
  return {
    // The brief asks for an internal flight ID, and it is the first thing it
    // asks for, so it is surfaced rather than hidden behind the provider's id.
    id: flight.id,
    providerFlightId: flight.providerFlightId,
    providerSource: flight.providerSource,
    flightNumber: flight.flightNumber,
    aircraftRegistration: flight.aircraftRegistration,
    aircraftHex: flight.aircraftHex,
    aircraftType: flight.aircraftType,
    flightDate: toDateString(flight.flightDate),
    origin: flight.origin,
    destination: flight.destination,
    scheduledDeparture: flight.scheduledDeparture?.toISOString() ?? null,
    status: flight.status,
    revision: flight.revision,
    trackingActive: flight.trackingActive,
    lastSyncedAt: flight.lastSyncedAt.toISOString(),
    freshness: staleness(flight.lastSyncedAt, now, flight.trackingActive),
  };
}

export function serializeChange(change: FlightChange) {
  return {
    id: change.id,
    field: change.field,
    oldValue: change.oldValue,
    newValue: change.newValue,
    fromRevision: change.fromRevision,
    toRevision: change.toRevision,
    detectedAt: change.detectedAt.toISOString(),
  };
}

export function serializeAlert(alert: Alert) {
  return {
    id: alert.id,
    flightId: alert.flightId,
    changeId: alert.changeId,
    title: alert.title,
    body: alert.body,
    severity: alert.severity,
    status: alert.status,
    createdAt: alert.createdAt.toISOString(),
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
  };
}
