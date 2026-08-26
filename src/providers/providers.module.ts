import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { FixtureProvider } from './fixture.provider';
import { Fr24Provider } from './fr24.provider';
import { FLIGHT_DATA_PROVIDER } from './provider.interface';

/**
 * Which provider is live is one environment variable. fixture is the default so
 * a fresh clone runs offline, free and deterministic; fr24 needs a key, and its
 * sandbox key is free and consumes no credits.
 */
@Global()
@Module({
  providers: [
    FixtureProvider,
    Fr24Provider,
    {
      provide: FLIGHT_DATA_PROVIDER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        env().FLIGHT_PROVIDER === 'fr24'
          ? new Fr24Provider()
          : new FixtureProvider(prisma),
    },
  ],
  exports: [FLIGHT_DATA_PROVIDER, FixtureProvider],
})
export class ProvidersModule {}
