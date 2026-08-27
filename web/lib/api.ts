/**
 * The service this dashboard reads. Everything is typed at the boundary, so a
 * field the API stops sending becomes a compile error here rather than an
 * `undefined` rendered into the page.
 */

export const API =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export type FlightStatus =
  | 'SCHEDULED'
  | 'AIRBORNE'
  | 'ARRIVED'
  | 'CANCELLED'
  | 'RESULT_UNKNOWN';

export type FreshnessLabel =
  | 'LIVE'
  | 'STALE'
  | 'NO CONNECTION'
  | 'TRACKING ENDED';

export interface Freshness {
  seconds: number;
  label: FreshnessLabel;
}

export interface Flight {
  id: string;
  providerFlightId: string;
  providerSource: string;
  flightNumber: string;
  aircraftRegistration: string | null;
  aircraftHex: string | null;
  aircraftType: string | null;
  /** YYYY-MM-DD, the local departure date at the origin. Never an instant. */
  flightDate: string;
  origin: string | null;
  destination: string | null;
  scheduledDeparture: string | null;
  status: FlightStatus;
  revision: number;
  trackingActive: boolean;
  lastSyncedAt: string;
  freshness: Freshness;
}

export interface FlightChange {
  id: string;
  field: 'FLIGHT_NUMBER' | 'AIRCRAFT_REGISTRATION';
  oldValue: string | null;
  newValue: string;
  fromRevision: number;
  toRevision: number;
  detectedAt: string;
}

export interface Alert {
  id: string;
  flightId: string;
  changeId: string;
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING';
  status: 'UNREAD' | 'ACKNOWLEDGED';
  createdAt: string;
  acknowledgedAt: string | null;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`${path} answered ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const listFlights = () => get<{ flights: Flight[] }>('/flights');

export const listAlerts = () =>
  get<{ unread: number; alerts: Alert[] }>('/alerts');

export const flightChanges = (id: string) =>
  get<{ flight: Flight; changes: FlightChange[] }>(`/flights/${id}/changes`);

export async function acknowledge(id: string): Promise<void> {
  const response = await fetch(`${API}/alerts/${id}/ack`, { method: 'POST' });
  if (!response.ok) throw new Error(`acknowledge answered ${response.status}`);
}

/** The demo trigger. Swaps the tail code so a change flows through for real. */
export async function simulateTailSwap(flightId?: string): Promise<void> {
  const response = await fetch(`${API}/ingest/demo/tail-swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(flightId ? { flightId } : {}),
  });

  if (!response.ok) throw new Error(`tail swap answered ${response.status}`);
}
