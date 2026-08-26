import { Module } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { AlertStream } from '../alerts/alert-stream';

@Module({
  providers: [IngestService, AlertStream],
  exports: [IngestService, AlertStream],
})
export class IngestModule {}
