import { movementChanged, nextStatus } from './status-transition';
import type { StoredTimes } from './status-transition';
import type { FlightSnapshot } from './types';

const OFF = new Date('2026-08-30T12:00:00Z');
const ON = new Date('2026-08-30T15:00:00Z');

const stored = (over: Partial<StoredTimes> = {}): StoredTimes => ({
  actualOff: null,
  actualOn: null,
  status: 'SCHEDULED',
  arrivedAt: null,
  ...over,
});

const snap = (over: Partial<FlightSnapshot> = {}): FlightSnapshot => ({
  providerFlightId: 'x',
  sourceTimestamp: new Date('2026-08-30T16:00:00Z'),
  ...over,
});

describe('nextStatus', () => {
  it('leaves a flight scheduled when the provider reports no times', () => {
    const next = nextStatus(stored(), snap());

    expect(next.status).toBe('SCHEDULED');
    expect(next.actualOff).toBeNull();
    expect(next.arrivedAt).toBeNull();
  });

  it('moves to airborne on a takeoff time', () => {
    const next = nextStatus(stored(), snap({ actualOff: OFF }));

    expect(next.status).toBe('AIRBORNE');
    expect(next.actualOff).toBe(OFF);
    expect(next.arrivedAt).toBeNull();
  });

  it('moves to arrived and opens the settle window on a landing time', () => {
    const next = nextStatus(
      stored({ actualOff: OFF, status: 'AIRBORNE' }),
      snap({ actualOn: ON }),
    );

    expect(next.status).toBe('ARRIVED');
    expect(next.arrivedAt).toBe(ON);
  });

  /**
   * The case that matters most. FlightAware sets off and on to the same instant
   * when it believes a flight landed but never had it confirmed. Calling that
   * ARRIVED would stop tracking the one flight whose outcome nobody knows.
   */
  it('does not open the settle window when the outcome was never confirmed', () => {
    const next = nextStatus(
      stored({ actualOff: OFF, status: 'AIRBORNE' }),
      snap({ actualOn: new Date(+OFF) }),
    );

    expect(next.status).toBe('RESULT_UNKNOWN');
    expect(next.arrivedAt).toBeNull();
  });

  it.each([
    ['absent', undefined],
    ['explicitly unknown', null],
  ])(
    'does not un-depart an airborne flight when takeoff is %s',
    (_l, value) => {
      const next = nextStatus(
        stored({ actualOff: OFF, status: 'AIRBORNE' }),
        snap({ actualOff: value }),
      );

      expect(next.status).toBe('AIRBORNE');
      expect(next.actualOff).toBe(OFF);
    },
  );

  it('cancels on the provider saying so', () => {
    const next = nextStatus(stored(), snap({ cancelled: true }));

    expect(next.status).toBe('CANCELLED');
  });

  it('stays cancelled when a later snapshot stops mentioning it', () => {
    const next = nextStatus(stored({ status: 'CANCELLED' }), snap());

    expect(next.status).toBe('CANCELLED');
  });
});

describe('movementChanged', () => {
  it('is false when nothing about movement moved', () => {
    const s = stored({ actualOff: OFF, status: 'AIRBORNE' });

    expect(movementChanged(s, nextStatus(s, snap()))).toBe(false);
  });

  it('is true when a takeoff time arrives', () => {
    const s = stored();

    expect(movementChanged(s, nextStatus(s, snap({ actualOff: OFF })))).toBe(
      true,
    );
  });

  it('is true when only the status moves', () => {
    const s = stored({ actualOff: OFF, actualOn: ON, status: 'AIRBORNE' });

    expect(movementChanged(s, nextStatus(s, snap()))).toBe(true);
  });
});
