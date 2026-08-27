'use client';

import Link from 'next/link';
import type { Flight } from '@/lib/api';
import { relativeTime, route, shortId, utcClock } from '@/lib/format';
import { FreshnessTag, Panel, StatusTag } from './primitives';

/**
 * A departure board, in the sense that matters: fixed columns, monospace
 * identifiers, and every row scannable without reading it.
 *
 * The internal flight ID is the first column because the brief names it first,
 * and because it is the only identifier here that cannot change — the flight
 * number and the tail code are both things this service exists to watch change.
 */
export function FlightBoard({ flights }: { flights: Flight[] }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {[
              'Flight ID',
              'Flight',
              'Tail',
              'Type',
              'Date',
              'Route',
              'Departs',
              'Status',
              'Data',
            ].map((heading) => (
              <th
                key={heading}
                className="px-3 py-2.5 text-left font-mono text-[10px] font-semibold tracking-[0.1em] whitespace-nowrap text-ink-faint uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {flights.map((flight) => (
            <tr
              key={flight.id}
              className="border-b border-line-soft transition-colors last:border-0 hover:bg-raised"
            >
              <td className="px-3 py-2.5 font-mono text-[12px] text-ink-faint">
                {shortId(flight.id)}
              </td>

              <td className="px-3 py-2.5">
                <Link
                  href={`/flights/${flight.id}`}
                  className="font-mono text-[13px] font-semibold text-signal hover:underline"
                >
                  {flight.flightNumber}
                </Link>
              </td>

              <td className="px-3 py-2.5 font-mono text-[12px]">
                {flight.aircraftRegistration ?? (
                  <span className="text-ink-faint">not reported</span>
                )}
              </td>

              <td className="px-3 py-2.5 font-mono text-[12px] text-ink-dim">
                {flight.aircraftType ?? '—'}
              </td>

              <td className="tabular px-3 py-2.5 font-mono text-[12px] text-ink-dim">
                {flight.flightDate}
              </td>

              <td className="px-3 py-2.5 font-mono text-[12px] whitespace-nowrap">
                {route(flight.origin, flight.destination)}
              </td>

              <td className="tabular px-3 py-2.5 font-mono text-[12px] whitespace-nowrap">
                {flight.scheduledDeparture === null ? (
                  // Flightradar24 publishes no schedules at all, so this is
                  // empty for every flight sourced there. Saying so beats
                  // printing a time we invented.
                  <span className="text-ink-faint">no schedule</span>
                ) : (
                  utcClock(flight.scheduledDeparture)
                )}
              </td>

              <td className="px-3 py-2.5">
                <StatusTag status={flight.status} />
              </td>

              <td className="px-3 py-2.5 whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <FreshnessTag label={flight.freshness.label} />
                  <span className="tabular font-mono text-[11px] text-ink-faint">
                    {relativeTime(flight.lastSyncedAt)}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
