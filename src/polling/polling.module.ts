import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { env } from '../config/env';
import { IngestModule } from '../ingest/ingest.module';
import { POLL_QUEUE, PollingProcessor } from './polling.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: env().REDIS_HOST,
        port: env().REDIS_PORT,
      },
    }),
    BullModule.registerQueue({
      name: POLL_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        // Left unbounded, the completed set grows without limit on a queue that
        // ticks twice a minute forever.
        removeOnComplete: { age: 3600, count: 200 },
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },
      },
    }),
    IngestModule,
  ],
  providers: [PollingProcessor],
})
export class PollingModule implements OnApplicationBootstrap {
  constructor(@InjectQueue(POLL_QUEUE) private readonly queue: Queue) {}

  /**
   * upsert rather than add: restarting the service must not accumulate a second
   * scheduler, and the same key makes the registration idempotent.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'sweep',
      { every: 30_000 },
      { name: 'sweep' },
    );
  }
}
