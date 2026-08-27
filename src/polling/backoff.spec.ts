import {
  backoffFor,
  MAX_RETRY_AFTER_MS,
  UNKNOWN_FAULT_BACKOFF_MS,
  UNRECOVERABLE_BACKOFF_MS,
} from './polling.processor';
import {
  RetryableProviderError,
  UnrecoverableProviderError,
} from '../providers/provider.interface';

/**
 * The retry classification only means something if it changes what happens
 * next. Before this existed, a 402 and an unknown fault were both re-tried in
 * five minutes — so an exhausted credit balance became the same request failing
 * 288 times a day with nobody told.
 */
describe('backoffFor', () => {
  it('parks a permanent refusal for an hour, not five minutes', () => {
    const error = new UnrecoverableProviderError(402, 'credit limit reached');

    expect(backoffFor(error)).toBe(UNRECOVERABLE_BACKOFF_MS);
    expect(backoffFor(error)).toBeGreaterThan(UNKNOWN_FAULT_BACKOFF_MS);
  });

  it.each([401, 403, 404, 422])(
    'treats %i the same as any other permanent refusal',
    (status) => {
      expect(backoffFor(new UnrecoverableProviderError(status, 'refused'))).toBe(
        UNRECOVERABLE_BACKOFF_MS,
      );
    },
  );

  it('waits exactly as long as a rate limit asked', () => {
    expect(backoffFor(new RetryableProviderError('429', 90_000))).toBe(90_000);
  });

  it('caps an unreasonable Retry-After rather than parking a flight for a day', () => {
    const error = new RetryableProviderError('429', 24 * 60 * 60_000);

    expect(backoffFor(error)).toBe(MAX_RETRY_AFTER_MS);
  });

  it.each([
    ['absent', undefined],
    ['zero', 0],
    ['negative', -1],
  ])(
    'falls back to the default when Retry-After is %s',
    (_label, retryAfterMs) => {
      const error = new RetryableProviderError('timeout', retryAfterMs);

      expect(backoffFor(error)).toBe(UNKNOWN_FAULT_BACKOFF_MS);
    },
  );

  it('does not throw on something that is not an Error at all', () => {
    expect(backoffFor('kaboom')).toBe(UNKNOWN_FAULT_BACKOFF_MS);
    expect(backoffFor(undefined)).toBe(UNKNOWN_FAULT_BACKOFF_MS);
  });
});
