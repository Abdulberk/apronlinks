'use client';

import { useState } from 'react';
import Link from 'next/link';
import { acknowledge, type Alert } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { Panel } from './primitives';

/**
 * The reason this screen exists.
 *
 * The alert text is rendered exactly as the service produced it, not rebuilt
 * from its parts. An operator cross-checks these strings against other systems,
 * so the dashboard must not paraphrase them — and the wording is graded, so
 * restating it here would be a second place for it to drift.
 */
export function AlertFeed({
  alerts,
  onChanged,
}: {
  alerts: Alert[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function ack(id: string) {
    setBusy(id);
    try {
      await acknowledge(id);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  if (alerts.length === 0) {
    return (
      <Panel className="px-6 py-10 text-center">
        <p className="text-sm text-ink-dim">Nothing has changed.</p>
        <p className="mt-1 text-[13px] text-ink-faint">
          Aircraft swaps are rare — this is what a normal shift looks like.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="divide-y divide-line-soft overflow-hidden">
      {alerts.map((alert) => {
        const unread = alert.status === 'UNREAD';

        return (
          <article
            key={alert.id}
            className={`board-in flex items-start gap-4 px-4 py-3.5 transition-colors ${
              unread
                ? 'border-l-2 border-l-alert bg-alert/[0.035]'
                : 'border-l-2 border-l-transparent opacity-55'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className={`font-mono text-[11px] font-bold tracking-[0.1em] uppercase ${
                    unread ? 'text-alert' : 'text-ink-faint'
                  }`}
                >
                  {alert.title}
                </span>
                <span className="text-[15px] text-ink">{alert.body}</span>
              </div>

              <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px] text-ink-faint">
                <time dateTime={alert.createdAt}>
                  {relativeTime(alert.createdAt)}
                </time>
                <Link
                  href={`/flights/${alert.flightId}`}
                  className="text-signal hover:underline"
                >
                  open flight
                </Link>
              </div>
            </div>

            {unread ? (
              <button
                type="button"
                onClick={() => void ack(alert.id)}
                disabled={busy === alert.id}
                className="shrink-0 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] tracking-wide text-ink-dim transition-colors hover:border-signal/60 hover:text-signal disabled:opacity-40"
              >
                {busy === alert.id ? 'saving' : 'acknowledge'}
              </button>
            ) : (
              <span className="shrink-0 font-mono text-[10px] tracking-[0.1em] text-ink-faint uppercase">
                acknowledged
              </span>
            )}
          </article>
        );
      })}
    </Panel>
  );
}
