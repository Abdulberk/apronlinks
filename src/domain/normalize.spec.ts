import {
  blankToNull,
  normalizeFlightNumber,
  normalizeRegistration,
} from './normalize';

describe('normalizeFlightNumber', () => {
  it.each([
    // The regression that matters. A greedy [A-Z0-9]{2,3} captures "TK0" here,
    // the overall match still succeeds, and the engine never backtracks — so
    // the padding zero is absorbed into the airline code and TK0234
    // "normalizes" to itself.
    ['TK0234', 'TK234'],
    ['AA0011', 'AA11'],
    ['LH0400', 'LH400'],
    ['9W0123', '9W123'],
    ['TK 0234', 'TK234'],
    ['tk0234', 'TK234'],
  ])('strips padding: %s -> %s', (input, expected) => {
    expect(normalizeFlightNumber(input)).toBe(expected);
  });

  it.each([
    ['ALX314', 'ALX314'],
    ['U2815', 'U2815'],
    ['SK7679', 'SK7679'],
    ['BA1', 'BA1'],
  ])('leaves unpadded numbers alone: %s', (input, expected) => {
    expect(normalizeFlightNumber(input)).toBe(expected);
  });

  it('passes through anything that is not designator-plus-digits', () => {
    // Callsigns, not flight numbers. Mangling them is worse than ignoring them.
    expect(normalizeFlightNumber('THY5LK')).toBe('THY5LK');
    expect(normalizeFlightNumber('N123AB')).toBe('N123AB');
  });
});

describe('normalizeRegistration', () => {
  it.each([
    ['nq-atc', 'NQATC'],
    ['NQ-ATC', 'NQATC'],
    ['NQ ATC ', 'NQATC'],
    ['nqatc', 'NQATC'],
    ['TC-JJA', 'TCJJA'],
    ['EI-SIN', 'EISIN'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRegistration(input)).toBe(expected);
  });
});

describe('blankToNull', () => {
  it('keeps undefined distinct from null', () => {
    expect(blankToNull(undefined)).toBeUndefined();
    expect(blankToNull(null)).toBeNull();
  });

  it('turns whitespace into null but keeps real values', () => {
    expect(blankToNull('   ')).toBeNull();
    expect(blankToNull('')).toBeNull();
    expect(blankToNull('NQ-ATC')).toBe('NQ-ATC');
  });
});
