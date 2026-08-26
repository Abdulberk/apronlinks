import { createHmac } from 'node:crypto';
import { TOLERANCE_SECONDS, sign, verifySignature } from './signature';

const SECRET = 'a-test-secret-of-sufficient-length';
const BODY = '{"eventId":"e1","providerFlightId":"f1"}';
const NOW = new Date('2026-08-26T12:00:00Z');

describe('verifySignature', () => {
  it('accepts a signature it just produced', () => {
    expect(verifySignature(BODY, sign(BODY, SECRET, NOW), SECRET, NOW)).toEqual(
      {
        ok: true,
      },
    );
  });

  it('accepts a Buffer body, which is how Fastify hands it over', () => {
    const header = sign(BODY, SECRET, NOW);
    expect(verifySignature(Buffer.from(BODY), header, SECRET, NOW)).toEqual({
      ok: true,
    });
  });

  it('rejects a body that changed by one byte', () => {
    const header = sign(BODY, SECRET, NOW);
    const tampered = BODY.replace('f1', 'f2');

    expect(verifySignature(tampered, header, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a signature made with a different secret', () => {
    const header = sign(BODY, 'some-other-secret-entirely', NOW);

    expect(verifySignature(BODY, header, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a missing header', () => {
    expect(verifySignature(BODY, undefined, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it.each([
    ['no parts at all', 'garbage'],
    ['timestamp only', 't=1787832000'],
    ['digest only', 'v1=abcdef'],
    ['non-numeric timestamp', 't=yesterday,v1=abcdef'],
  ])('rejects a malformed header: %s', (_label, header) => {
    expect(verifySignature(BODY, header, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a digest of the wrong length without throwing', () => {
    // timingSafeEqual throws on mismatched lengths, and letting that escape
    // would turn a forged signature into a 500 instead of a 401. The timestamp
    // has to be current or the window check answers first and this path is
    // never reached.
    const current = Math.floor(+NOW / 1000);

    expect(verifySignature(BODY, `t=${current},v1=ab`, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a digest that is not hex without throwing', () => {
    const current = Math.floor(+NOW / 1000);

    expect(verifySignature(BODY, `t=${current},v1=zz`, SECRET, NOW).ok).toBe(
      false,
    );
  });

  describe('replay window', () => {
    it('accepts a delivery at the edge of the window', () => {
      const edge = new Date(+NOW - TOLERANCE_SECONDS * 1000);
      expect(
        verifySignature(BODY, sign(BODY, SECRET, edge), SECRET, NOW).ok,
      ).toBe(true);
    });

    it('rejects a delivery just past the window', () => {
      // Without this, a request captured off the wire stays valid forever and
      // an attacker never needs the secret to replay it.
      const stale = new Date(+NOW - (TOLERANCE_SECONDS + 1) * 1000);

      expect(
        verifySignature(BODY, sign(BODY, SECRET, stale), SECRET, NOW),
      ).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    it('rejects a delivery from too far in the future', () => {
      const ahead = new Date(+NOW + (TOLERANCE_SECONDS + 1) * 1000);

      expect(
        verifySignature(BODY, sign(BODY, SECRET, ahead), SECRET, NOW),
      ).toEqual({
        ok: false,
        reason: 'expired',
      });
    });
  });

  it('signs the timestamp together with the body, not the body alone', () => {
    // If the timestamp were outside the signed payload, an attacker could take
    // a captured request and simply rewrite it to be current again.
    const header = sign(BODY, SECRET, NOW);
    const digestOfBodyAlone = createHmac('sha256', SECRET)
      .update(BODY)
      .digest('hex');

    expect(header).not.toContain(digestOfBodyAlone);
  });
});
