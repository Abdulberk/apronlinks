// Prisma 7 moved three things out of where they used to live:
//   - .env is no longer auto-loaded
//   - the `prisma.seed` key in package.json is no longer read
//   - `url` is no longer allowed in the schema's datasource block
// All three now live here.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
