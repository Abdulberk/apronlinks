import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far a delivery's timestamp may be from ours before we refuse it. */
export const TOLERANCE_SECONDS = 300;

export type VerifyResult =
  { ok: true } | { ok: false; reason: 'malformed' | 'expired' | 'mismatch' };

/**
 * Verifies `X-Signature: t=<unix>,v1=<hex>` over the raw request body.
 *
 * This is deliberately the shape Stripe uses, because it is the same problem:
 * an endpoint that must accept work from outside and cannot trust the caller.
 * Three details do the work, and each of them is load-bearing.
 *
 * The RAW body is signed, not the parsed object. Any middleware that parses
 * JSON first has already changed the bytes — key order, whitespace, number
 * formatting — and the HMAC no longer matches something the sender computed.
 *
 * The TIMESTAMP is inside the signed payload and checked against a window.
 * Without it a valid request captured off the wire stays valid forever, so an
 * attacker does not need the secret to replay it.
 *
 * The COMPARISON is constant time. A byte-by-byte compare that returns early
 * leaks, through timing, how much of a guess was right, which turns forging a
 * signature into a series of cheap guesses instead of one impossible one.
 */
export function verifySignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  if (header === undefined) return { ok: false, reason: 'malformed' };

  const parts = new Map(
    header
      .split(',')
      .map((piece) => piece.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key, value] as const),
  );

  const timestamp = parts.get('t');
  const provided = parts.get('v1');

  if (timestamp === undefined || provided === undefined) {
    return { ok: false, reason: 'malformed' };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'malformed' };

  const driftSeconds = Math.abs(Math.floor(+now / 1000) - sentAt);
  if (driftSeconds > TOLERANCE_SECONDS) return { ok: false, reason: 'expired' };

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString()}`)
    .digest();

  let candidate: Buffer;
  try {
    candidate = Buffer.from(provided, 'hex');
  } catch {
    return { ok: false, reason: 'mismatch' };
  }

  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length, so check that first and fail the same way either way.
  if (candidate.length !== expected.length)
    return { ok: false, reason: 'mismatch' };
  if (!timingSafeEqual(candidate, expected))
    return { ok: false, reason: 'mismatch' };

  return { ok: true };
}

/** Used by the demo script and by the signature tests. */
export function sign(
  rawBody: string,
  secret: string,
  now: Date = new Date(),
): string {
  const timestamp = Math.floor(+now / 1000).toString();
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return `t=${timestamp},v1=${digest}`;
}
