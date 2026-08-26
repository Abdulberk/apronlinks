// Prisma 7 moved three things out of where they used to live: .env is no
// longer auto-loaded, the `prisma.seed` key in package.json is no longer read,
// and `url` is no longer allowed in the schema's datasource block.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Read through process.env rather than Prisma's env() helper, which throws the
// moment the config is loaded. `prisma generate` only reads the schema — it
// never opens a connection — so requiring a database URL to generate a client
// would mean the Docker build stage needs credentials it has no use for.
// migrate and seed do need it, and fail with a clear message if it is absent.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
