'use client';

import { useState } from 'react';
import { simulateNumberChange, simulateTailSwap } from '@/lib/api';
import { useLiveData } from '@/hooks/useLiveData';
import { AlertFeed } from '@/components/AlertFeed';
import { FlightBoard } from '@/components/FlightBoard';
import { Panel, SectionLabel, Stat } from '@/components/primitives';

export default function Dashboard() {
  const { flights, alerts, unread, connection, error, loaded, refresh } =
    useLiveData();
  const [simulating, setSimulating] = useState<null | 'tail' | 'number'>(null);

  // Two triggers, because the service watches two fields. Being able to raise
  // only one of them would leave the other looking like a claim.
  async function simulate(which: 'tail' | 'number') {
    setSimulating(which);
    try {
      await (which === 'tail' ? simulateTailSwap() : simulateNumberChange());
      await refresh();
    } finally {
      setSimulating(null);
    }
  }

  const tracked = flights.filter((f) => f.trackingActive).length;
  const degraded = flights.filter(
    (f) => f.freshness.label === 'NO CONNECTION',
  ).length;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-ground/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-6 py-3.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[15px] font-semibold tracking-tight">
              Flight Change Alerts
            </h1>
            <span className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">
              apronlinks
            </span>
          </div>

          <ConnectionBadge state={connection} />

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => void simulate('tail')}
            disabled={simulating !== null}
            className="rounded bg-signal px-3 py-1.5 text-[12px] font-semibold text-ground transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {simulating === 'tail' ? 'Swapping…' : 'Simulate aircraft change'}
          </button>

          <button
            type="button"
            onClick={() => void simulate('number')}
            disabled={simulating !== null}
            className="rounded border border-signal/60 px-3 py-1.5 text-[12px] font-semibold text-signal transition-colors hover:bg-signal/10 disabled:opacity-50"
          >
            {simulating === 'number'
              ? 'Renumbering…'
              : 'Simulate flight number change'}
          </button>

          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-line px-3 py-1.5 font-mono text-[11px] tracking-wide text-ink-dim transition-colors hover:border-signal/60 hover:text-signal"
          >
            refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-7">
        {error !== null && (
          <Panel className="mb-6 border-alert/40 px-4 py-3">
            <p className="text-[13px] text-alert">
              Cannot reach the service — {error}
            </p>
            <p className="mt-1 text-[12px] text-ink-faint">
              Everything below is the last thing we saw, not the current state.
            </p>
          </Panel>
        )}

        <section className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tracked" value={tracked} hint="flights being followed" />
          <Stat
            label="Unread alerts"
            value={unread}
            tone={unread > 0 ? 'alert' : 'neutral'}
            hint={unread === 0 ? 'nothing waiting' : 'need a decision'}
          />
          <Stat
            label="Changes recorded"
            value={alerts.length}
            hint="in the visible window"
          />
          <Stat
            label="Not reporting"
            value={degraded}
            tone={degraded > 0 ? 'alert' : 'neutral'}
            hint="overdue against their own cadence"
          />
        </section>

        <section className="mb-7">
          <SectionLabel>Alerts</SectionLabel>
          {loaded ? (
            <AlertFeed alerts={alerts} onChanged={() => void refresh()} />
          ) : (
            <Skeleton rows={3} />
          )}
        </section>

        <section>
          <SectionLabel>Tracked flights</SectionLabel>
          {loaded ? <FlightBoard flights={flights} /> : <Skeleton rows={6} />}
        </section>

        <footer className="mt-8 font-mono text-[11px] leading-relaxed text-ink-faint">
          <p>
            Times are UTC, as aviation runs on UTC — converting them to your own
            zone would put back the ambiguity the industry standardised away.
          </p>
          <p className="mt-1">
            Updates arrive over a live stream and are re-checked every five
            seconds, so a dropped push costs a delay rather than an alert.
          </p>
        </footer>
      </main>
    </div>
  );
}

function ConnectionBadge({ state }: { state: 'connecting' | 'live' | 'polling' }) {
  const copy = {
    connecting: { text: 'connecting', tone: 'text-ink-faint', dot: 'bg-ink-faint' },
    live: { text: 'live', tone: 'text-ok', dot: 'bg-ok' },
    polling: { text: 'polling', tone: 'text-warn', dot: 'bg-warn' },
  }[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase ${copy.tone}`}
    >
      <span
        className={`size-1.5 rounded-full ${copy.dot} ${state === 'live' ? 'pulse-dot' : ''}`}
      />
      {copy.text}
    </span>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <Panel className="divide-y divide-line-soft">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="px-4 py-4">
          <div className="h-3 w-2/5 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </Panel>
  );
}
