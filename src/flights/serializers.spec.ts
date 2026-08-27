import { staleness, toDateString } from './serializers';

const NOW = new Date('2026-08-27T14:00:00Z');

describe('staleness', () => {
  const ONE_MINUTE = 60_000;

  it.each([
    ['just synced', 10, 'LIVE'],
    ['inside twice the interval', 119, 'LIVE'],
    ['past twice the interval', 121, 'STALE'],
    ['inside six times the interval', 359, 'STALE'],
    ['past six times the interval', 361, 'NO CONNECTION'],
  ])('one-minute cadence, %s -> %s', (_label, secondsAgo, expected) => {
    const at = new Date(+NOW - secondsAgo * 1000);
    expect(staleness(at, NOW, true, ONE_MINUTE).label).toBe(expected);
  });

  it('does not call a slowly-polled flight disconnected', () => {
    // The cadence is tiered, so a flight two days out is checked every six
    // hours. Against a flat threshold every one of those would sit permanently
    // on NO CONNECTION while the system worked exactly as designed — and a
    // dashboard that is always red is a dashboard nobody reads.
    const SIX_HOURS = 6 * 3600 * 1000;
    const anHourAgo = new Date(+NOW - 3600 * 1000);

    expect(staleness(anHourAgo, NOW, true, SIX_HOURS).label).toBe('LIVE');
    expect(staleness(anHourAgo, NOW, true, ONE_MINUTE).label).toBe(
      'NO CONNECTION',
    );
  });

  it('reports a flight we stopped following as ended, not as lost', () => {
    const longAgo = new Date(+NOW - 6 * 3600 * 1000);

    expect(staleness(longAgo, NOW, false, ONE_MINUTE).label).toBe(
      'TRACKING ENDED',
    );
    expect(staleness(longAgo, NOW, true, ONE_MINUTE).label).toBe(
      'NO CONNECTION',
    );
  });

  it('still reports the elapsed seconds when tracking has ended', () => {
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
