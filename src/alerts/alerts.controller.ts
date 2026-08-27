import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { serializeAlert } from '../flights/serializers';
import { AlertStream } from './alert-stream';

interface StreamMessage {
  data: { type: 'alert' | 'ping'; flightId?: string };
}

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertStream,
  ) {}

  @Get()
  async list(@Query('status') status?: string) {
    const alerts = await this.prisma.alert.findMany({
      where: status === 'unread' ? { status: 'UNREAD' } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const unread = await this.prisma.alert.count({
      where: { status: 'UNREAD' },
    });

    return { unread, alerts: alerts.map(serializeAlert) };
  }

  // ParseUUIDPipe rather than letting Prisma reject it: Postgres answers a
  // malformed uuid with 22P02, which surfaces as a 500 for what is plainly a
  // bad request. A stale dashboard tab acknowledging an alert after a re-seed
  // hits exactly this.
  @Post(':id/ack')
  async acknowledge(@Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.alert.updateMany({
      where: { id, status: 'UNREAD' },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });

    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (alert === null) throw new NotFoundException(`no alert ${id}`);

    return serializeAlert(alert);
  }

  /**
   * Server-sent events rather than websockets: the traffic is one-way, and
   * EventSource reconnects on its own.
   *
   * The heartbeat is not decoration. Azure Container Apps closes an idle
   * request at four minutes, so a stream that says nothing during a quiet spell
   * is dropped mid-demo. Twenty seconds keeps it comfortably inside that.
   *
   * At-most-once by design: this carries a nudge, not the payload. Clients
   * refetch on the nudge and on reconnect, so a push that arrives while nobody
   * is listening costs a delay rather than a lost alert.
   */
  @Sse('stream')
  stream(): Observable<StreamMessage> {
    const alerts = this.alerts
      .observe()
      .pipe(
        map((flightId) => ({ data: { type: 'alert' as const, flightId } })),
      );

    const heartbeat = interval(20_000).pipe(
      map(() => ({ data: { type: 'ping' as const } })),
    );

    return merge(alerts, heartbeat);
  }
}
