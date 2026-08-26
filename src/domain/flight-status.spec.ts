import { deriveStatus } from './flight-status';

const OFF = new Date('2026-08-26T10:15:00Z');
const ON = new Date('2026-08-26T12:40:00Z');

describe('deriveStatus — FlightAware rules, quoted from the AeroAPI FAQ', () => {
  it('has not departed when there is no actual_off', () => {
    expect(deriveStatus({ actualOff: null, actualOn: null })).toBe('SCHEDULED');
  });

  it('is en route when actual_off is set and actual_on is not', () => {
    expect(deriveStatus({ actualOff: OFF, actualOn: null })).toBe('AIRBORNE');
  });

  it('has arrived when both are set and differ', () => {
    expect(deriveStatus({ actualOff: OFF, actualOn: ON })).toBe('ARRIVED');
  });

  it('is an unconfirmed result when both are set and equal', () => {
    // "probably arrived but we don't have an arrival confirmation"
    expect(deriveStatus({ actualOff: OFF, actualOn: new Date(+OFF) })).toBe(
      'RESULT_UNKNOWN',
    );
  });

  it('compares by value, not by object identity', () => {
    expect(
      deriveStatus({ actualOff: new Date(+OFF), actualOn: new Date(+OFF) }),
    ).toBe('RESULT_UNKNOWN');
  });

  it('reports cancellation ahead of every other rule', () => {
    expect(
      deriveStatus({ cancelled: true, actualOff: OFF, actualOn: ON }),
    ).toBe('CANCELLED');
  });

  it('does not treat cancelled:false as cancelled', () => {
    expect(
      deriveStatus({ cancelled: false, actualOff: null, actualOn: null }),
    ).toBe('SCHEDULED');
  });
});
