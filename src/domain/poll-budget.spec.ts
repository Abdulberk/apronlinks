import { nextPollDelay, HOUR, MINUTE } from './poll-tiers';
import type { FlightStatus } from './types';

/**
 * The one number in this project that gets quoted out loud.
 *
 * "Tiered polling is roughly 87% cheaper than a flat one-minute cadence" was a
 * comment, which means it was an assertion nobody could check. This walks a
 * whole flight through the real function and counts, so the claim is derived
 * from the code rather than sitting next to it.
 */

/** Replays one flight from `fromMs` before departure to the end of tracking. */
function countPolls(options: { leadMs: number; airborneMs: number }): {
  polls: number;
  flatPolls: number;
} {
  const departure = new Date('2026-08-28T12:00:00.000Z');
  const start = new Date(+departure - options.leadMs);

  let now = start;
  let status: FlightStatus = 'SCHEDULED';
  let arrivedAt: Date | null = null;
  let polls = 0;

  // A generous ceiling. If the cadence ever fails to terminate, this trips
  // instead of hanging the suite — the bug that guard exists for is a stop
  // condition that never fires.
  for (let guard = 0; guard < 100_000; guard += 1) {
    const delay = nextPollDelay(
      { status, scheduledDeparture: departure, arrivedAt },
      now,
    );
    if (delay === null) break;

    polls += 1;
    now = new Date(+now + delay);

    if (status === 'SCHEDULED' && +now >= +departure) {
      status = 'AIRBORNE';
    }
    if (status === 'AIRBORNE' && +now >= +departure + options.airborneMs) {
      status = 'ARRIVED';
      arrivedAt = new Date(+departure + options.airborneMs);
    }
  }

  return { polls, flatPolls: Math.round((+now - +start) / MINUTE) };
}

describe('polling budget', () => {
  it('costs about 200 polls for a flight tracked from two days out', () => {
    const { polls } = countPolls({ leadMs: 48 * HOUR, airborneMs: 3 * HOUR });

    // Pinned as a range rather than an exact figure: the point is the order of
    // magnitude against 1440 polls a day, not a number that breaks whenever a
    // tier is tuned.
    expect(polls).toBeGreaterThan(150);
    expect(polls).toBeLessThan(260);
  });

  it('is at least 85% cheaper than polling every minute', () => {
    const { polls, flatPolls } = countPolls({
      leadMs: 48 * HOUR,
      airborneMs: 3 * HOUR,
    });

    const saved = 1 - polls / flatPolls;

    expect(saved).toBeGreaterThan(0.85);
  });

  it('spends its budget where it matters: the last half hour is polled every minute', () => {
    const departure = new Date('2026-08-28T12:00:00.000Z');

    for (const minutesOut of [30, 20, 10, 1]) {
      const delay = nextPollDelay(
        {
          status: 'SCHEDULED',
          scheduledDeparture: departure,
          arrivedAt: null,
        },
        new Date(+departure - minutesOut * MINUTE),
      );

      expect(delay).toBe(MINUTE);
    }
  });

  it('always terminates — tracking a flight is not a subscription for life', () => {
    const { polls } = countPolls({ leadMs: 48 * HOUR, airborneMs: 14 * HOUR });

    expect(polls).toBeLessThan(1_000);
  });
});
