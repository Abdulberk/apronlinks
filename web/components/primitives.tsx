import type { ReactNode } from 'react';
import type { FreshnessLabel, FlightStatus } from '@/lib/api';

/**
 * The vocabulary the rest of the screen is built from.
 *
 * State is encoded in shape as well as colour — a border, a dot, a weight — so
 * the screen still reads for anyone who cannot separate the hues, and so a
 * glance at a dense table lands on the row that needs attention rather than on
 * whichever cell happens to be brightest.
 */

export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'signal' | 'ok' | 'warn' | 'alert' | 'muted';
}) {
  const tones: Record<string, string> = {
    neutral: 'border-line text-ink-dim',
    signal: 'border-signal/50 text-signal',
    ok: 'border-ok/50 text-ok',
    warn: 'border-warn/50 text-warn',
    alert: 'border-alert/50 text-alert',
    muted: 'border-line-soft text-ink-faint',
  };

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const FRESHNESS_TONE: Record<FreshnessLabel, 'ok' | 'warn' | 'alert' | 'muted'> = {
  LIVE: 'ok',
  STALE: 'warn',
  'NO CONNECTION': 'alert',
  // Not a failure. We stopped following this flight because it landed, and
  // dressing that as an alarm teaches people to ignore the alarm.
  'TRACKING ENDED': 'muted',
};

export function FreshnessTag({ label }: { label: FreshnessLabel }) {
  return <Tag tone={FRESHNESS_TONE[label]}>{label}</Tag>;
}

const STATUS_TONE: Record<FlightStatus, 'neutral' | 'signal' | 'muted' | 'warn'> = {
  SCHEDULED: 'neutral',
  AIRBORNE: 'signal',
  ARRIVED: 'muted',
  CANCELLED: 'warn',
  RESULT_UNKNOWN: 'warn',
};

export function StatusTag({ status }: { status: FlightStatus }) {
  return (
    <Tag tone={STATUS_TONE[status]}>
      {status === 'RESULT_UNKNOWN' ? 'UNCONFIRMED' : status}
    </Tag>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
      {children}
    </h2>
  );
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A value that moved. Rendered as a transition rather than two loose strings,
 * because the operator's question is never "what are these two values" — it is
 * "what changed, and to what".
 */
export function ValueChange({
  from,
  to,
}: {
  from: string | null;
  to: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[13px]">
      <span className="text-ink-faint line-through decoration-alert/60">
        {from ?? '—'}
      </span>
      <span className="text-ink-faint">→</span>
      <span className="font-semibold text-ink">{to}</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'alert' | 'signal';
  hint?: string;
}) {
  const valueTone =
    tone === 'alert' ? 'text-alert' : tone === 'signal' ? 'text-signal' : 'text-ink';

  return (
    <Panel className="px-4 py-3">
      <div className="font-mono text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
        {label}
      </div>
      <div className={`tabular mt-1.5 font-mono text-2xl font-semibold ${valueTone}`}>
        {value}
      </div>
      {hint !== undefined && (
        <div className="mt-0.5 text-[11px] text-ink-faint">{hint}</div>
      )}
    </Panel>
  );
}
