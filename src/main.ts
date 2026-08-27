// Must be first: module decorators read configuration at import time, so the
// file has to be loaded before the module graph is. In production the real
// environment is already set and this finds nothing to do.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      // Must be set here: HMAC verification needs the bytes exactly as sent,
      // and this cannot be enabled after the adapter is constructed.
      rawBody: true,
      bufferLogs: true,
    },
  );

  app.useLogger(app.get(Logger));

  await app.register(helmet, {
    // Swagger UI is served from this origin and helmet's default CSP blocks it.
    contentSecurityPolicy: false,
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  if (env.CORS_ORIGINS) {
    app.enableCors({ origin: env.CORS_ORIGINS.split(','), credentials: true });
  }

  // Without this, Nest never fires onApplicationShutdown on SIGTERM, so the
  // BullMQ workers are killed mid-job instead of being closed cleanly.
  app.enableShutdownHooks();

  // 0.0.0.0, not the Fastify default of localhost: inside a container the
  // default is unreachable from the host.
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
