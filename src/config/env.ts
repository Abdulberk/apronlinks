import { z } from 'zod';

/**
 * Every environment variable the service reads, validated once at boot.
 *
 * Two details that matter more than they look:
 *
 * 1. Numeric variables use `.int().positive()` rather than a bare
 *    `z.coerce.number()`. Coercion turns an EMPTY string into 0 and reports
 *    success — and an empty string is exactly what a copied-but-unedited
 *    `.env`, a `docker run -e KEY=`, or a blank Azure secret produces. A
 *    timeout that silently becomes 0 is worse than one that is missing.
 *
 * 2. Validation runs through ConfigModule so the process exits before it ever
 *    listens. A misconfigured service should fail at boot, never at 3am on the
 *    first request that happens to touch the bad value.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().positive().max(20).default(5),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  /** fixture is the default so a fresh clone runs offline, free and deterministic. */
  FLIGHT_PROVIDER: z.enum(['fixture', 'fr24']).default('fixture'),
  FR24_API_KEY: z.string().optional(),
  FR24_BASE_URL: z.string().url().default('https://fr24api.flightradar24.com'),
  /**
   * The provider's OpenAPI spec says 15; its prose documentation says 10.
   * We take the conservative value: exceeding the real cap returns a billable
   * 4xx that cannot be retried into success.
   */
  FR24_MAX_IDS_PER_QUERY: z.coerce.number().int().positive().max(15).default(10),

  /**
   * Kept below the platform's shutdown grace period. A provider call that
   * outlives SIGTERM eats the whole window the queue needs to drain.
   */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().max(15_000).default(8_000),

  /** Shared secret for the signed ingest endpoint. Never a real value in git. */
  INGEST_HMAC_SECRET: z.string().min(16, 'INGEST_HMAC_SECRET must be at least 16 characters'),

  /** Comma separated. Only needed by a separately hosted frontend. */
  CORS_ORIGINS: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration\n${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
}
