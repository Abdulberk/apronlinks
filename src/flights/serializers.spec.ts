import { staleness, toDateString } from './serializers';

const NOW = new Date('2026-08-27T14:00:00Z');

describe('staleness', () => {
  it.each([
    ['just synced', 10, 'LIVE'],
    ['inside two minutes', 119, 'LIVE'],
    ['past two minutes', 121, 'STALE'],
    ['inside fifteen minutes', 899, 'STALE'],
    ['past fifteen minutes', 901, 'NO CONNECTION'],
  ])('%s -> %s', (_label, secondsAgo, expected) => {
    const at = new Date(+NOW - secondsAgo * 1000);
    expect(staleness(at, NOW).label).toBe(expected);
  });

  it('reports a flight we stopped following as ended, not as lost', () => {
    // A landed flight is not a flight we lost contact with. Labelling it
    // NO CONNECTION describes a failure that did not happen — and an operator
    // who learns to ignore that label will ignore it on the flight where it is
    // real.
    const longAgo = new Date(+NOW - 6 * 3600 * 1000);

    expect(staleness(longAgo, NOW, false).label).toBe('TRACKING ENDED');
    expect(staleness(longAgo, NOW, true).label).toBe('NO CONNECTION');
  });

  it('still reports the elapsed seconds when tracking has ended', () => {
    // The number stays useful even when the label stops being an alarm.
    const at = new Date(+NOW - 3600 * 1000);
    expect(staleness(at, NOW, false).seconds).toBe(3600);
  });
});

describe('toDateString', () => {
  it('renders a calendar date, never an instant', () => {
    // Prisma has no date-only type, so the column comes back as UTC midnight.
    // Sent as an instant, a browser west of UTC renders the previous day.
    expect(toDateString(new Date('2026-08-27T00:00:00.000Z'))).toBe(
      '2026-08-27',
    );
  });
});
