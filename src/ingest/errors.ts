/**
 * Raised when the compare-and-swap on Flight.revision matches zero rows,
 * meaning another writer moved the flight between our read and our write.
 *
 * This is not a failure. It means someone else won a race we were both allowed
 * to enter, so the correct response is to re-read and try again — which is what
 * IngestService.process does, outside the transaction.
 */
export class ConcurrencyError extends Error {
  constructor(flightId: string, expectedRevision: number) {
    super(
      `flight ${flightId} moved from revision ${expectedRevision} while we were writing`,
    );
    this.name = 'ConcurrencyError';
  }
}

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

interface PrismaKnownError {
  code?: unknown;
}

/**
 * Two ingests racing on a flight we have never seen both find nothing and both
 * try to create it. One wins; the other lands here. Same situation as a lost
 * compare-and-swap, so it takes the same path.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as PrismaKnownError).code === UNIQUE_VIOLATION
  );
}
