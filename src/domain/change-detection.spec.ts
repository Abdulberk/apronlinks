import { detectChanges } from './change-detection';
import type { FlightSnapshot, FlightState } from './types';

const T0 = new Date('2026-08-26T10:00:00Z');

const state = (over: Partial<FlightState> = {}): FlightState => ({
  flightNumber: 'ALX314',
  aircraftRegistration: 'NQ-ATC',
  ...over,
});

const snap = (over: Partial<FlightSnapshot> = {}): FlightSnapshot => ({
  providerFlightId: 'fr24-1',
  sourceTimestamp: T0,
  ...over,
});

describe('detectChanges — the two graded fields', () => {
  it('detects an aircraft registration change', () => {
    expect(
      detectChanges(state(), snap({ aircraftRegistration: 'NQ-BRD' })),
    ).toEqual([
      {
        field: 'AIRCRAFT_REGISTRATION',
        oldValue: 'NQ-ATC',
        newValue: 'NQ-BRD',
        alertable: true,
      },
    ]);
  });

  it('detects a flight number change', () => {
    expect(detectChanges(state(), snap({ flightNumber: 'ALX320' }))).toEqual([
      {
        field: 'FLIGHT_NUMBER',
        oldValue: 'ALX314',
        newValue: 'ALX320',
        alertable: true,
      },
    ]);
  });

  it('reports both fields separately when both move in one snapshot', () => {
    const changes = detectChanges(
      state(),
      snap({ flightNumber: 'ALX320', aircraftRegistration: 'NQ-BRD' }),
    );

    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.field)).toEqual([
      'FLIGHT_NUMBER',
      'AIRCRAFT_REGISTRATION',
    ]);
  });

  it('reports nothing when the snapshot repeats what we already hold', () => {
    expect(
      detectChanges(
        state(),
        snap({ flightNumber: 'ALX314', aircraftRegistration: 'NQ-ATC' }),
      ),
    ).toEqual([]);
  });

  it('preserves provider formatting in oldValue and newValue', () => {
    // Normalized for comparison, stored as received: the operator will
    // cross-check these strings against other systems.
    const changes = detectChanges(
      state(),
      snap({ aircraftRegistration: 'nq-brd' }),
    );

    expect(changes[0]?.newValue).toBe('nq-brd');
    expect(changes[0]?.oldValue).toBe('NQ-ATC');
  });
});

describe('detectChanges — absence is not information', () => {
  it('ignores a field the provider did not send', () => {
    expect(detectChanges(state(), snap({}))).toEqual([]);
  });

  it('does not erase a known value when the provider sends an explicit null', () => {
    // A provider that stopped reporting a tail number has not changed it.
    expect(
      detectChanges(state(), snap({ aircraftRegistration: null })),
    ).toEqual([]);
  });

  it('treats a blank string as no information rather than as a value', () => {
    expect(
      detectChanges(state(), snap({ aircraftRegistration: '   ' })),
    ).toEqual([]);
  });

  it('records a first observation but does not make it alertable', () => {
    expect(
      detectChanges(
        state({ aircraftRegistration: null }),
        snap({ aircraftRegistration: 'NQ-ATC' }),
      ),
    ).toEqual([
      {
        field: 'AIRCRAFT_REGISTRATION',
        oldValue: null,
        newValue: 'NQ-ATC',
        alertable: false,
      },
    ]);
  });

  it('treats a previously blank value as a first observation, not a change', () => {
    const changes = detectChanges(
      state({ aircraftRegistration: '' }),
      snap({ aircraftRegistration: 'NQ-ATC' }),
    );

    expect(changes[0]?.alertable).toBe(false);
    expect(changes[0]?.oldValue).toBeNull();
  });
});

describe('detectChanges — formatting must never raise a false alert', () => {
  it.each([
    ['lower case', 'nq-atc'],
    ['trailing whitespace', 'NQ-ATC '],
    ['no hyphen', 'NQATC'],
    ['lower case and no hyphen', 'nqatc'],
  ])('registration: %s is the same aircraft', (_label, incoming) => {
    expect(
      detectChanges(state(), snap({ aircraftRegistration: incoming })),
    ).toEqual([]);
  });

  it.each([
    ['zero padded', 'TK0234', 'TK234'],
    ['double zero padded', 'AA0011', 'AA11'],
    ['zero padded three digit', 'LH0400', 'LH400'],
    ['alphanumeric designator', '9W0123', '9W123'],
    ['space separated', 'TK 234', 'TK234'],
    ['space and zero', 'TK 0234', 'TK234'],
  ])('flight number: %s (%s) matches %s', (_label, incoming, held) => {
    expect(
      detectChanges(
        state({ flightNumber: held }),
        snap({ flightNumber: incoming }),
      ),
    ).toEqual([]);
  });

  it('does not fold a genuinely different flight number', () => {
    expect(
      detectChanges(
        state({ flightNumber: 'TK234' }),
        snap({ flightNumber: 'TK235' }),
      ),
    ).toHaveLength(1);
  });

  it('does not treat a three-letter ICAO designator as zero padded', () => {
    // ALX314 must keep its X. A greedy [A-Z0-9]{2,3} would capture ALX, then
    // succeed on 314 and never reveal the bug — which is why the padded
    // two-letter cases above matter more than this one.
    expect(
      detectChanges(
        state({ flightNumber: 'ALX314' }),
        snap({ flightNumber: 'ALX314' }),
      ),
    ).toEqual([]);
  });
});

describe('detectChanges — the unknown-flight-number sentinel', () => {
  it('does not alert when a placeholder is replaced by a real number', () => {
    // A flight can arrive without a number, and the column is NOT NULL, so a
    // sentinel gets written. Comparing it as a value produces
    // "Flight number changed from UNKNOWN to ALX314" — a meaningless alert on
    // a dashboard whose whole point is that alerts mean something.
    const changes = detectChanges(
      state({ flightNumber: 'UNKNOWN' }),
      snap({ flightNumber: 'ALX314' }),
    );

    expect(changes).toEqual([
      {
        field: 'FLIGHT_NUMBER',
        oldValue: null,
        newValue: 'ALX314',
        alertable: false,
      },
    ]);
  });

  it('still records the enrichment in history', () => {
    // Recorded but not alertable: the history should show where the value came
    // from, without paging anyone about it.
    const changes = detectChanges(
      state({ flightNumber: 'UNKNOWN' }),
      snap({ flightNumber: 'ALX314' }),
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.oldValue).toBeNull();
  });
});
