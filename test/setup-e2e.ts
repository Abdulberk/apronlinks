// The e2e suite talks to the Postgres from docker-compose. Point at it
// explicitly rather than inheriting whatever happens to be in .env, so the
// tests cannot quietly run against a different database than they claim to.
import 'dotenv/config';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/flightalerts?schema=public';
process.env.INGEST_HMAC_SECRET ??= 'test-secret-at-least-sixteen-characters';
process.env.LOG_LEVEL ??= 'error';
