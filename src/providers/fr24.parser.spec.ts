import { parseBatch, parseProviderTimestamp, toSnapshot } from './fr24.parser';

describe('parseProviderTimestamp', () => {
  it('reads a zoned timestamp as the instant it states', () => {
    // The form live/flight-positions returns.
    expect(parseProviderTimestamp('2026-08-26T15:36:56Z').toISOString()).toBe(
      '2026-08-26T15:36:56.000Z',
    );
  });

  it('reads a zoneless timestamp as UTC, not as local time', () => {
    // The form flight-summary returns. Both appear in the provider's own schema
    // examples for the same field, which is why the check has to be on the
    // value rather than on which endpoint it arrived from.
    //
    // Without the guard this is parsed as local time: measured on a machine in
    // Istanbul, a silent three-hour shift in the exact field used to decide
    // whether a snapshot is newer than what we already hold.
    expect(parseProviderTimestamp('2023-01-27T05:15:22').toISOString()).toBe(
      '2023-01-27T05:15:22.000Z',
    );
  });

  it('does not corrupt a timestamp carrying an explicit offset', () => {
    expect(
      parseProviderTimestamp('2026-08-26T18:36:56+03:00').toISOString(),
    ).toBe('2026-08-26T15:36:56.000Z');
  });

  it('refuses a value it cannot parse instead of returning an invalid date', () => {
    // An Invalid Date compares false against everything, so the ordering guard
    // would silently fail open and let stale data overwrite fresh data.
    expect(() => parseProviderTimestamp('not a date')).toThrow();
  });
});

describe('toSnapshot', () => {
  const observedAt = new Date('2026-08-26T12:00:00Z');

  it('correlates on fr24_id rather than on anything that can change', () => {
    const snapshot = toSnapshot(
      {
        fr24_id: '380ce8ef',
        flight: 'SK1415',
        reg: 'SE-DOY',
        last_seen: '2023-01-27T06:18:10',
      },
      observedAt,
    );

    expect(snapshot.providerFlightId).toBe('380ce8ef');
    expect(snapshot.flightNumber).toBe('SK1415');
    expect(snapshot.aircraftRegistration).toBe('SE-DOY');
    expect(snapshot.sourceTimestamp.toISOString()).toBe(
      '2023-01-27T06:18:10.000Z',
    );
  });

  it('keeps a null field null rather than turning it into an empty string', () => {
    // The provider marks every field except the id nullable, and the
    // distinction survives all the way to change detection: an absent value
    // must not overwrite a known one.
    const snapshot = toSnapshot(
      { fr24_id: '380ce8ef', flight: null, reg: null, last_seen: null },
      observedAt,
    );

    expect(snapshot.flightNumber).toBeNull();
    expect(snapshot.aircraftRegistration).toBeNull();
  });

  it('falls back to our clock only when the provider offers no timestamp', () => {
    const snapshot = toSnapshot({ fr24_id: '380ce8ef' }, observedAt);
    expect(snapshot.sourceTimestamp).toEqual(observedAt);
  });
});

describe('parseBatch', () => {
  const observedAt = new Date('2026-08-26T12:00:00Z');

  it('parses a well formed batch', () => {
    const { snapshots, rejected } = parseBatch(
      {
        data: [
          {
            fr24_id: 'a',
            flight: 'SK1',
            reg: 'SE-AAA',
            last_seen: '2026-08-26T10:00:00Z',
          },
          {
            fr24_id: 'b',
            flight: 'SK2',
            reg: 'SE-BBB',
            last_seen: '2026-08-26T10:01:00Z',
          },
        ],
      },
      observedAt,
    );

    expect(snapshots).toHaveLength(2);
    expect(rejected).toBe(0);
  });

  it('loses only the malformed record, not the batch around it', () => {
    // One bad entry in a batch of ten should cost that entry. Failing the whole
    // response would let a single provider glitch stop every flight in it.
    const { snapshots, rejected } = parseBatch(
      {
        data: [
          { fr24_id: 'a', flight: 'SK1', last_seen: '2026-08-26T10:00:00Z' },
          { flight: 'SK2' },
          { fr24_id: 'c', flight: 'SK3', last_seen: 'nonsense' },
        ],
      },
      observedAt,
    );

    expect(snapshots.map((s) => s.providerFlightId)).toEqual(['a']);
    expect(rejected).toBe(2);
  });

  it('ignores fields it does not know about', () => {
    // A provider adding a field is a non-event. Rejecting on it would turn
    // their routine release into our outage.
    const { snapshots, rejected } = parseBatch(
      {
        data: [
          {
            fr24_id: 'a',
            flight: 'SK1',
            last_seen: '2026-08-26T10:00:00Z',
            some_new_field: { nested: true },
          },
        ],
      },
      observedAt,
    );

    expect(snapshots).toHaveLength(1);
    expect(rejected).toBe(0);
  });

  it('returns nothing for a response that is not shaped like a batch', () => {
    expect(parseBatch({ unexpected: true }, observedAt)).toEqual({
      snapshots: [],
      rejected: 0,
    });
  });
});

describe('toSnapshot — movement times', () => {
  const observedAt = new Date('2026-08-30T18:00:00Z');

  const record = (over: Record<string, unknown> = {}) => ({
    fr24_id: 'fr24-1',
    flight: 'TK1985',
    reg: 'TC-JJA',
    last_seen: '2026-08-30T17:00:00Z',
    ...over,
  });

  it('carries a takeoff time through so status can be derived', () => {
    const snapshot = toSnapshot(
      record({ datetime_takeoff: '2026-08-30T12:00:00Z' }),
      observedAt,
    );

    expect(snapshot.actualOff).toEqual(new Date('2026-08-30T12:00:00Z'));
    expect(snapshot.actualOn).toBeUndefined();
  });

  it('carries a landing time through', () => {
    const snapshot = toSnapshot(
      record({
        datetime_takeoff: '2026-08-30T12:00:00Z',
        datetime_landed: '2026-08-30T15:00:00Z',
      }),
      observedAt,
    );

    expect(snapshot.actualOn).toEqual(new Date('2026-08-30T15:00:00Z'));
  });

  /**
   * Absent must stay absent rather than becoming null. Both mean "keep what we
   * hold", so the behaviour is the same either way — but a null would claim the
   * provider said "unknown" when it said nothing at all.
   */
  it('leaves movement absent when the provider reports none', () => {
    const snapshot = toSnapshot(record(), observedAt);

    expect('actualOff' in snapshot).toBe(false);
    expect('actualOn' in snapshot).toBe(false);
  });

  /**
   * flight_ended closes the tracking session, which happens at the end of every
   * ordinary flight. Reading it as a cancellation would mark almost every
   * completed flight CANCELLED and stop tracking it for the wrong reason.
   */
  it('does not read flight_ended as a cancellation', () => {
    const snapshot = toSnapshot(
      record({ flight_ended: true, datetime_landed: '2026-08-30T15:00:00Z' }),
      observedAt,
    );

    expect(snapshot.cancelled).toBeUndefined();
  });
});
