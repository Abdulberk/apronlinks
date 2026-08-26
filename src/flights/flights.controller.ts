import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { serializeChange, serializeFlight } from './serializers';

@Controller('flights')
export class FlightsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    const take = Math.min(Number(limit) || 50, 200);
    const now = new Date();

    const flights = await this.prisma.flight.findMany({
      take,
      orderBy: [{ scheduledDeparture: 'asc' }, { flightNumber: 'asc' }],
    });

    return { flights: flights.map((f) => serializeFlight(f, now)) };
  }

  /**
   * The brief asks for a history of detected changes to be kept. Kept but
   * unreachable is not kept, so it has an endpoint — and the flip-flop case
   * (A to B to A to B) is the clearest evidence that history is appended to
   * rather than overwritten.
   */
  @Get(':id/changes')
  async changes(@Param('id') id: string) {
    const flight = await this.prisma.flight.findUnique({ where: { id } });
    if (flight === null) throw new NotFoundException(`no flight ${id}`);

    const changes = await this.prisma.flightChange.findMany({
      where: { flightId: id },
      orderBy: { detectedAt: 'desc' },
      take: 50,
    });

    return {
      flight: serializeFlight(flight),
      changes: changes.map(serializeChange),
    };
  }
}
