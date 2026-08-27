'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { flightChanges, type Flight, type FlightChange } from '@/lib/api';
import { relativeTime, route, shortId, utcClock } from '@/lib/format';
import {
  FreshnessTag,
  Panel,
  SectionLabel,
  StatusTag,
  Tag,
  ValueChange,
} from '@/components/primitives';

/**
 * One flight, and everything that has happened to it.
 *
 * The history is the point. An aircraft can swap back and forth — ATC to BRD to
 * ATC — and every leg of that is a real change someone had to react to. Seeing
 * them listed is the clearest evidence that history is appended to rather than
 * overwritten, which no summary figure can show.
 */
export default function FlightDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [flight, setFlight] = useState<Flight | null>(null);
  const [changes, setChanges] = useState<FlightChange[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await flightChanges(id);
      setFlight(data.flight);
      setChanges(data.changes);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not load');
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (error !== null) {
    return (
      <Shell>
        <Panel className="border-alert/40 px-4 py-3">
          <p className="text-[13px] text-alert">{error}</p>
        </Panel>
      </Shell>
    );
  }

  if (flight === null) {
    return (
      <Shell>
        <Panel className="px-4 py-8">
          <div className="h-3 w-1/3 animate-pulse rounded bg-raised" />
        </Panel>
      </Shell>
    );
  }

  return (
    <Shell>
      <Panel className="mb-6 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <span className="font-mono text-2xl font-semibold tracking-tight">
            {flight.flightNumber}
          </span>
          <span className="font-mono text-[13px] text-ink-dim">
            {route(flight.origin, flight.destination)}
          </span>
          <StatusTag status={flight.status} />
          <FreshnessTag label={flight.freshness.label} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Internal ID" value={shortId(flight.id)} title={flight.id} />
          <Field label="Aircraft" value={flight.aircraftRegistration ?? 'not reported'} />
          <Field label="Type" value={flight.aircraftType ?? '—'} />
          <Field label="Flight date" value={flight.flightDate} />
          <Field
            label="Departs"
            value={
              flight.scheduledDeparture === null
                ? 'no schedule published'
                : utcClock(flight.scheduledDeparture)
            }
          />
          <Field label="Revision" value={String(flight.revision)} />
          <Field label="Mode-S" value={flight.aircraftHex ?? '—'} />
          <Field label="Source" value={flight.providerSource} />
          <Field label="Provider ID" value={flight.providerFlightId} />
          <Field label="Last heard" value={relativeTime(flight.lastSyncedAt)} />
        </dl>
      </Panel>

      <SectionLabel>Change history</SectionLabel>

      {changes.length === 0 ? (
        <Panel className="px-6 py-10 text-center">
          <p className="text-sm text-ink-dim">
            Nothing about this flight has changed.
          </p>
        </Panel>
      ) : (
        <Panel className="divide-y divide-line-soft">
          {changes.map((change) => (
            <div key={change.id} className="flex items-start gap-4 px-4 py-3.5">
              <span className="tabular mt-0.5 shrink-0 font-mono text-[11px] text-ink-faint">
                rev {change.fromRevision}→{change.toRevision}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Tag tone={change.field === 'AIRCRAFT_REGISTRATION' ? 'alert' : 'signal'}>
                    {change.field === 'AIRCRAFT_REGISTRATION' ? 'AIRCRAFT' : 'FLIGHT NO'}
                  </Tag>
                  <ValueChange from={change.oldValue} to={change.newValue} />
                </div>

                <div className="mt-1 font-mono text-[11px] text-ink-faint">
                  {relativeTime(change.detectedAt)}
                  {change.oldValue === null && (
                    <span className="ml-2">
                      first observation — recorded, not alerted
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Panel>
      )}

      <p className="mt-5 max-w-prose font-mono text-[11px] leading-relaxed text-ink-faint">
        Revisions only ever increase, which is why an aircraft moving back to a
        tail it carried before is recorded as another change rather than
        suppressed as a repeat of the first.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-ground/85 backdrop-blur">
        <div className="mx-auto max-w-[1100px] px-6 py-3.5">
          <Link
            href="/"
            className="font-mono text-[11px] tracking-[0.1em] text-ink-dim uppercase hover:text-signal"
          >
            ← all flights
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-6 py-7">{children}</main>
    </div>
  );
}

function Field({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-[13px] break-all" title={title}>
        {value}
      </dd>
    </div>
  );
}
