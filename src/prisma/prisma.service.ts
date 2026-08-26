import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const config = env();

    // Prisma 7 dropped the Rust query engine: the client now talks to Postgres
    // through a driver adapter, and the pool size lives here rather than in the
    // connection string.
    //
    // The ceiling matters more than the number. Prisma's own default is
    // num_cpus * 2 + 1 and the engine does not read container CPU limits, so a
    // half-core container on a large host opens far more connections than it
    // has any use for. Multiply that by replica count and a small managed
    // Postgres runs out of connections long before it runs out of capacity.
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        max: config.DB_POOL_MAX,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
