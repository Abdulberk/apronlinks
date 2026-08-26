import {
  ABANDON_AFTER_DEPARTURE,
  HOUR,
  MINUTE,
  UNSCHEDULED_WATCH,
  nextPollDelay,
} from './poll-tiers';
import type { FlightStatus, PollableFlight } from './types';

const NOW = new Date('2026-08-26T12:00:00Z');

const flight = (
  status: FlightStatus,
  minutesUntilDeparture: number | null,
  arrivedAt: Date | null = null,
): PollableFlight => ({
  status,
  scheduledDeparture:
    minutesUntilDeparture === null
      ? null
      : new Date(+NOW + minutesUntilDeparture * MINUTE),
  arrivedAt,
});

describe('nextPollDelay — cadence tracks operational urgency', () => {
  it.each([
    ['inside 30 minutes of departure', 10, 1 * MINUTE],
    ['exactly at the 30 minute boundary', 30, 1 * MINUTE],
    ['just outside 30 minutes', 31, 5 * MINUTE],
    ['inside 3 hours', 120, 5 * MINUTE],
    ['exactly at the 3 hour boundary', 180, 5 * MINUTE],
    ['just outside 3 hours', 181, 30 * MINUTE],
    ['inside 24 hours', 20 * 60, 30 * MINUTE],
    ['exactly at the 24 hour boundary', 24 * 60, 30 * MINUTE],
    ['beyond 24 hours', 24 * 60 + 1, 6 * HOUR],
  ])('%s', (_label, minutes, expected) => {
    expect(nextPollDelay(flight('SCHEDULED', minutes), NOW)).toBe(expected);
  });

  it('polls an airborne flight every two minutes', () => {
    expect(nextPollDelay(flight('AIRBORNE', -60), NOW)).toBe(2 * MINUTE);
  });
});

describe('nextPollDelay — no schedule available', () => {
  it('falls back to a steady watch rather than inventing a departure time', () => {
    // Every FR24-sourced flight lands here: that API publishes no schedule.
    expect(nextPollDelay(flight('SCHEDULED', null), NOW)).toBe(
      UNSCHEDULED_WATCH,
    );
  });

  it('still prefers the airborne cadence when status is known', () => {
    expect(nextPollDelay(flight('AIRBORNE', null), NOW)).toBe(2 * MINUTE);
  });

  it('still stops on cancellation without a schedule', () => {
    expect(nextPollDelay(flight('CANCELLED', null), NOW)).toBeNull();
  });
});

describe('nextPollDelay — stopping', () => {
  it('stops tracking a cancelled flight', () => {
    expect(nextPollDelay(flight('CANCELLED', 60), NOW)).toBeNull();
  });

  it('stops once an arrival has settled', () => {
    expect(
      nextPollDelay(flight('ARRIVED', -120, new Date(+NOW - 31 * MINUTE)), NOW),
    ).toBeNull();
  });

  it('keeps watching briefly right after arrival', () => {
    expect(
      nextPollDelay(flight('ARRIVED', -120, new Date(+NOW - 5 * MINUTE)), NOW),
    ).toBe(5 * MINUTE);
  });

  it('regression: the settle comparison must be numeric, not string concatenation', () => {
    // `date + 30 * MINUTE` concatenates in JavaScript and the comparison then
    // silently evaluates to false, so this stop condition never fires at all.
    expect(
      nextPollDelay(flight('ARRIVED', -180, new Date(+NOW - 2 * HOUR)), NOW),
    ).toBeNull();
  });

  it('keeps a slow watch when marked arrived without a timestamp', () => {
    expect(nextPollDelay(flight('ARRIVED', -120, null), NOW)).toBe(
      UNSCHEDULED_WATCH,
    );
  });

  it('keeps a slow watch on an unconfirmed result rather than declaring arrival', () => {
    expect(nextPollDelay(flight('RESULT_UNKNOWN', -120), NOW)).toBe(
      UNSCHEDULED_WATCH,
    );
  });

  it('abandons a flight that never departed and is long past its slot', () => {
    expect(
      nextPollDelay(
        {
          status: 'SCHEDULED',
          scheduledDeparture: new Date(+NOW - ABANDON_AFTER_DEPARTURE - MINUTE),
          arrivedAt: null,
        },
        NOW,
      ),
    ).toBeNull();
  });

  it('still polls a flight that is merely late, not abandoned', () => {
    expect(
      nextPollDelay(
        {
          status: 'SCHEDULED',
          scheduledDeparture: new Date(+NOW - 2 * HOUR),
          arrivedAt: null,
        },
        NOW,
      ),
    ).toBe(1 * MINUTE);
  });
});
