import type { Alert, Flight, FlightChange } from '../generated/prisma/client';
import { nextPollDelay } from '../domain';

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
  expectedIntervalMs: number | null = null,
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

  // Late relative to how often we said we would look, not to a fixed clock.
  //
  // The cadence is tiered on purpose: a flight two days out is checked every
  // six hours. Judged against a flat fifteen-minute threshold, every one of
  // those would sit permanently on NO CONNECTION while the system worked
  // exactly as designed — and a dashboard that is permanently red is a
  // dashboard nobody reads.
  const expected = (expectedIntervalMs ?? 60_000) / 1000;

  if (seconds < expected * 2) return { seconds, label: 'LIVE' };
  if (seconds < expected * 6) return { seconds, label: 'STALE' };
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
    // Derived from the same function the poller uses, so the badge and the
    // schedule can never disagree about what 'on time' means for this flight.
    freshness: staleness(
      flight.lastSyncedAt,
      now,
      flight.trackingActive,
      nextPollDelay(
        {
          status: flight.status,
          scheduledDeparture: flight.scheduledDeparture,
          arrivedAt: flight.arrivedAt,
        },
        now,
      ),
    ),
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
