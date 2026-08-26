import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { IngestModule } from '../ingest/ingest.module';

@Module({ imports: [IngestModule], controllers: [AlertsController] })
export class AlertsModule {}
