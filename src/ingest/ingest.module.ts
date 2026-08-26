import { Module } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { AlertStream } from '../alerts/alert-stream';
import { IngestController } from './ingest.controller';

@Module({
  controllers: [IngestController],
  providers: [IngestService, AlertStream],
  exports: [IngestService, AlertStream],
})
export class IngestModule {}
