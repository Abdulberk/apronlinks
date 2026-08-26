import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // A correlation id on every line is what makes a single ingest
        // traceable across the poll, the transaction and the alert.
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
        transport:
          process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
        redact: ['req.headers.authorization', 'req.headers["x-apikey"]', 'req.headers["x-signature"]'],
      },
    }),
  ],
})
export class AppModule {}
